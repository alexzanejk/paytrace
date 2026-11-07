// PayTrace's door for the owner's Admin Hub (migration 062): read the payments held for review and settle them.
//
//   GET  /functions/v1/hub/held            -> {"payments":[{id, provider, amount, trx_id, at, phone, reason, candidates:[...]}], "at"}
//   POST /functions/v1/hub/credit          {"payment_id","order_id","actor"}  -> {"result":"matched"} | {"error":"..."}
//   POST /functions/v1/hub/ignore          {"payment_id","actor"}             -> {"result":"ignored"} | {"error":"..."}
//   Authorization: Bearer <a Hub key made on the dashboard's Websites page, pth_…>
//
// Credit and ignore run the SAME database code as the dashboard's own Review buttons (manual_match_core,
// ignore_payment_core), so no rule about money lives here. 401 wrong key, 429 too many calls (120 a minute),
// 400 a bad request, 500 the database did not answer. The Hub's server calls this; it is not for browsers.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { actorOf, extractHubKey, isUuid, routeOf } from "./logic.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...extra } });

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Turns the database's answer into the HTTP answer: key problems and the rate limit first. */
function answer(data: Record<string, unknown> | null, error: { code?: string } | null): Response {
  if (error) {
    console.error("hub rpc failed", error.code);
    return json({ error: "not available, try again" }, 500);
  }
  if (data?.unauthorized) return json({ error: "unauthorized" }, 401);
  if (data?.limited) return json({ error: "too many calls, try again in a minute" }, 429, { "retry-after": "60" });
  if (typeof data?.error === "string") return json({ error: data.error }, 400);
  return json(data ?? {});
}

Deno.serve(async (req) => {
  const route = routeOf(new URL(req.url).pathname, req.method);
  if (!route) return json({ error: "unknown route" }, 404);
  const key = extractHubKey(req.headers.get("authorization"));
  if (!key) return json({ error: "unauthorized" }, 401);
  const hash = await sha256hex(key);

  if (route === "held") {
    const { data, error } = await db.rpc("hub_held", { p_key_hash: hash });
    return answer(data, error);
  }

  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > 2000) return json({ error: "payload too large" }, 413);
    body = JSON.parse(text || "{}");
    if (body === null || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
  } catch {
    return json({ error: "send a JSON body" }, 400);
  }
  if (!isUuid(body.payment_id)) return json({ error: "payment_id is required" }, 400);
  const actor = actorOf(body.actor);

  if (route === "credit") {
    if (!isUuid(body.order_id)) return json({ error: "order_id is required" }, 400);
    const { data, error } = await db.rpc("hub_credit", { p_key_hash: hash, p_payment: body.payment_id, p_order: body.order_id, p_actor: actor });
    const res = answer(data, error);
    // A deposit just got paid: tell its website now instead of on the minute timer.
    if (res.status === 200 && (data as { result?: string } | null)?.result === "matched") {
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/gateway/deliver`, {
        method: "POST", headers: { authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` }, body: "{}",
      }).then((x) => x.body?.cancel()).catch(() => {});
    }
    return res;
  }
  const { data, error } = await db.rpc("hub_ignore", { p_key_hash: hash, p_payment: body.payment_id, p_actor: actor });
  return answer(data, error);
});
