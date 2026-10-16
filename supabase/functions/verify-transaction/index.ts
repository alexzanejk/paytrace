// PayTrace transaction check: "did this transaction ID really arrive in our payment account?"
//
//   POST /functions/v1/verify-transaction
//   Authorization: Bearer <a key made on the dashboard's API access page>
//   {"transaction_id": "ABC123XYZ9", "provider": "bkash", "amount": 500}     provider and amount are optional
//   -> 200 {"found": false}
//   -> 200 {"found": true, "provider": "bkash", "amount": 500, "currency": "BDT", "amount_matches": true}
//
// Read-only: it never changes anything. It returns the provider and amount of a found transaction (the owner chose
// this, so a submitted ID can be checked against the amount the customer claims) and nothing else: no phone numbers,
// balances or message text. "amount_matches" appears only when the caller sent an "amount". Errors: 400 bad request,
// 401 wrong or missing key, 429 too many lookups (try again in a minute), 503/500 not available. A caller that
// gets anything but 200 should show "Pending check" and retry, not "Unverified".
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { amountsEqual, extractKey, normalizeAmount, normalizeProvider, normalizeTrx } from "./logic.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const LIMIT_PER_MINUTE = 60; // per key

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...extra } });

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "use POST" }, 405, { allow: "POST" });

  const key = extractKey(req.headers.get("authorization"));
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

  const claimed = normalizeAmount(body.amount);
  if (claimed === null) return json({ error: "amount must be a positive number, for example 500 or 500.50" }, 400);

  // Whatever cannot be a transaction ID cannot have been paid. It is still checked against the key (a revoked key
  // always gets 401) and counted by the rate limit, but never matches a payment.
  const trx = normalizeTrx(body.transaction_id);

  // Only a hash of the key is stored. The database checks it is a live (not revoked) key, then does the lookup.
  const { data, error } = await db.rpc("verify_transaction", {
    p_trx: trx ?? "-",
    p_provider: provider ?? null,
    p_key_id: await sha256hex(key),
    p_limit: LIMIT_PER_MINUTE,
  });
  if (error) {
    console.error("verify_transaction failed", error.code);
    return json({ error: "lookup failed, try again" }, 500);
  }
  if (data?.unauthorized) return json({ error: "unauthorized" }, 401);
  if (data?.limited) return json({ error: "too many lookups, try again in a minute" }, 429, { "retry-after": "60" });
  if (!trx || data?.found !== true) return json({ found: false });
  // The same ID exists on two providers and the caller did not say which: do not guess an amount.
  if (data.ambiguous) return json({ found: true, ambiguous: true, message: "send provider to pick one" });
  const amount = Number(data.amount);
  const out: Record<string, unknown> = { found: true, provider: data.provider, amount, currency: "BDT" };
  if (claimed !== undefined) out.amount_matches = amountsEqual(claimed, amount);
  return json(out);
});
