// PayTrace transaction check: "did this transaction ID really arrive in our payment account?"
//
//   POST /functions/v1/verify-transaction
//   Authorization: Bearer <one of the keys in the VERIFY_API_KEYS secret>
//   {"transaction_id": "ABC123XYZ9", "provider": "bkash"}      provider is optional
//   -> 200 {"found": true}  or  {"found": false}
//
// Read-only: it never changes anything and never returns amounts or other details. Errors: 400 bad request,
// 401 wrong or missing key, 429 too many lookups (try again in a minute), 503/500 not available. A caller that
// gets anything but 200 should show "Pending check" and retry, not "Unverified".
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { authenticate, normalizeProvider, normalizeTrx, parseKeys } from "./logic.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const KEYS = parseKeys(Deno.env.get("VERIFY_API_KEYS"));
const LIMIT_PER_MINUTE = 60; // per key

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...extra } });

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "use POST" }, 405, { allow: "POST" });
  if (KEYS.length === 0) return json({ error: "not configured" }, 503);

  const key = authenticate(req.headers.get("authorization"), KEYS);
  if (!key) return json({ error: "unauthorized" }, 401);

  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > 2000) return json({ error: "payload too large" }, 413);
    body = JSON.parse(text || "{}");
    if (body === null || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
  } catch {
    return json({ error: "send a JSON body" }, 400);
  }
  if (body.transaction_id === undefined) return json({ error: "transaction_id is required" }, 400);

  const provider = normalizeProvider(body.provider);
  if (provider === null) return json({ error: "provider must be bkash, nagad, rocket or upay" }, 400);

  // Whatever cannot be a transaction ID cannot have been paid, so it is answered without touching the database.
  const trx = normalizeTrx(body.transaction_id);
  if (!trx) return json({ found: false });

  const keyId = (await sha256hex(key)).slice(0, 8);
  const { data, error } = await db.rpc("verify_transaction", {
    p_trx: trx,
    p_provider: provider ?? null,
    p_key_id: keyId,
    p_limit: LIMIT_PER_MINUTE,
  });
  if (error) {
    console.error("verify_transaction failed", error.code);
    return json({ error: "lookup failed, try again" }, 500);
  }
  if (data?.limited) return json({ error: "too many lookups, try again in a minute" }, 429, { "retry-after": "60" });
  return json({ found: data?.found === true });
});
