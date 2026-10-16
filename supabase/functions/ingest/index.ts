// PayTrace ingest endpoint: receives SMS data from the Android app.
// Auth: `Authorization: <INGEST_SECRET>` (or "Bearer <secret>"). Supports POST (JSON) and GET (query string).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { parseSms, senderMatchesProvider, type Provider } from "./parser.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INGEST_SECRET = Deno.env.get("INGEST_SECRET") ?? "";
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

async function log(kind: string, provider: string | null, detail: Record<string, unknown>, paymentId?: string) {
  await db.from("events").insert({ kind, provider, payment_id: paymentId ?? null, detail });
}

Deno.serve(async (req) => {
  if (!INGEST_SECRET || INGEST_SECRET.length < 16) return json({ success: false, message: "server not configured" }, 500);

  // ---- auth ----
  const supplied = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!supplied || !safeEqual(supplied, INGEST_SECRET)) {
    return json({ success: false, message: "unauthorized" }, 401);
  }

  // ---- read payload (POST json or GET query) ----
  let body: Record<string, unknown> = {};
  try {
    if (req.method === "POST") {
      const text = await req.text();
      if (text.length > 20000) return json({ success: false, message: "payload too large" }, 413);
      body = JSON.parse(text || "{}");
    } else if (req.method === "GET") {
      body = Object.fromEntries(new URL(req.url).searchParams.entries());
    } else {
      return json({ success: false, message: "method not allowed" }, 405);
    }
  } catch {
    return json({ success: false, message: "invalid JSON" }, 400);
  }

  const str = (k: string) => (body[k] == null ? "" : String(body[k]).slice(0, 2000));
  const raw = str("raw_message");
  const hint = str("platform").toLowerCase();
  const senderId = str("sender_id");

  // ---- connection test: acknowledge, store nothing ----
  if (body.test === true || body.test === "true" || /^TEST/i.test(str("trx_id"))) {
    await log("test", hint || null, { note: "connection test" });
    return json({ success: true, message: "Connection OK", test: true });
  }

  if (!raw) return json({ success: false, message: "raw_message required" }, 400);

  // ---- parse on the server (so parser fixes never need an app update) ----
  const result = parseSms(raw, hint);
  if (result.kind === "ignored") {
    await log("ignored", hint || null, { reason: result.reason, raw });
    return json({ success: true, message: "ignored: not a payment", ignored: true });
  }
  if (result.kind === "failed") {
    await log("parse_failed", hint || null, { reason: result.reason, raw });
    // success:true so the app stops retrying; the text is kept in the log for review
    return json({ success: true, message: "stored for review: could not parse", parsed: false });
  }
  const d = result.data;

  // ---- sender must really be the provider's SMS ID (blocks look-alike texts from normal numbers) ----
  if (senderId && !senderMatchesProvider(senderId, d.provider as Provider)) {
    await log("rejected_sender", d.provider, { sender_id: senderId, trx_id: d.trxId });
    return json({ success: false, message: "sender not recognized" }, 403);
  }

  // ---- provider toggle held on the server too ----
  const { data: settings } = await db.from("settings").select("enabled_providers").eq("id", true).single();
  if (settings && !settings.enabled_providers.includes(d.provider)) {
    await log("provider_disabled", d.provider, { trx_id: d.trxId });
    return json({ success: true, message: "provider disabled on server", ignored: true });
  }

  // ---- status rules ----
  let status = "unmatched";
  let reviewReason: string | null = null;
  if (d.txnType === "cash_out") status = "tracked_only"; // receipts only, never credit an order
  else if (d.txnType === "unknown") { status = "review"; reviewReason = "unrecognized_type"; }
  else if (d.confidence === "generic") { status = "review"; reviewReason = "unverified_format"; }

  // ---- insert; the unique (provider, trx_id) rule makes duplicates impossible ----
  const { data: inserted, error } = await db
    .from("payments")
    .insert({
      provider: d.provider, txn_type: d.txnType, trx_id: d.trxId,
      amount: d.amount, fee: d.fee, commission: d.commission, balance: d.balance,
      counterparty: d.counterparty, occurred_at: d.occurredAt,
      raw_message: raw, status, review_reason: reviewReason,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      await log("duplicate", d.provider, { trx_id: d.trxId });
      return json({ success: true, message: "Duplicate: already recorded", duplicate: true });
    }
    await log("error", d.provider, { code: error.code });
    return json({ success: false, message: "could not save" }, 500); // app will retry
  }

  await log("created", d.provider, { trx_id: d.trxId, type: d.txnType, amount: d.amount }, inserted.id);

  // ---- try to match to an order that already claimed this TrxID ----
  let matchResult = status;
  if (status === "unmatched") {
    const { data: r } = await db.rpc("reconcile_payment", { p_payment_id: inserted.id });
    if (typeof r === "string") matchResult = r;
  }
  return json({ success: true, message: "Payment received", payment_id: inserted.id, status: matchResult });
});
