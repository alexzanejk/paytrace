// PayTrace gateway: deposit orders for the owner's own websites.
//
// Website servers (Authorization: Bearer <key from the dashboard's API access page>):
//   POST /functions/v1/gateway/create-deposit  {"amount":500,"order_id":"SHOP-1001","provider":"bkash","method":"cash_out"?,"return_url":"https://..."?,
//                                                "expires_in_minutes":15?,"customer_name"?,"customer_phone"?}
//        -> {"tracking_number","pay_url","status","expires_at"}     (the same order_id returns the same order)
//        optional "group": a wallet group such as "dvw9166" (max 24 characters); unknown, switched-off or offline groups fall back to "main".
//        provider "usdt_bep20" or "usdt_trc20": amount is still in taka; the answer has crypto {chain, asset, amount (USDT to send), address}.
//   POST /functions/v1/gateway/groups           {"group":"dvw9166"}   creates a partner group (any case; 3 letters + 4 digits; nothing happens if it already exists)
//        (create-deposit also creates the group the first time it sees a valid code)
//   GET  /functions/v1/gateway/groups           -> [{group,enabled,phone_name,provider,method,number,online}]   (no balances, no SMS text)
//   POST /functions/v1/gateway/groups/enabled   {"group":"dvw9166","enabled":false}   switches a group off or on ("main" cannot be off)
//   POST /functions/v1/gateway/order-status    {"tracking_number":"..."} or {"order_id":"SHOP-1001"}
// The customer's pay page (public; the tracking number is an unguessable secret; browser calls come only from the dashboard's address):
//   POST /gateway/pay-order   {"tracking_number"}                      what the page shows
//   POST /gateway/pay-pick    {"tracking_number","provider"}           fallback only: gives an order that has no number yet one for its own provider
//   POST /gateway/pay-submit  {"tracking_number","transaction_id"}     the customer's TrxID
// Scheduler (pg_cron, every minute; no auth needed, it returns nothing):
//   POST /gateway/deliver     sends the waiting result messages to the websites and closes unpaid orders.
// Crediting is never done here: it goes through the database's claim_order / reconcile_payment, same as every other payment.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { extractKey, isCrypto, isUuid, normalizeGroup, normalizeTrx, parseDeposit, parseGroupCode, signWebhook, submitState, type DepositRequest } from "./logic.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const DASHBOARD_URL = (Deno.env.get("DASHBOARD_URL") ?? "https://paytrace.ashkawser54.workers.dev").replace(/\/+$/, "");
const DASHBOARD_ORIGIN = new URL(DASHBOARD_URL).origin;
// The customer pay page can live on its own address (secret PAY_URL, for example https://pay.example.com). New orders get
// pay links on it; until it is set the dashboard's address is used, exactly as before.
const PAY_URL = (Deno.env.get("PAY_URL") ?? DASHBOARD_URL).replace(/\/+$/, "");
const PAY_ORIGIN = new URL(PAY_URL).origin;
// Pay links already given to customers keep working: the original address stays allowed beside any new one.
const LEGACY_ORIGIN = "https://paytrace.ashkawser54.workers.dev";
const PAY_ORIGINS = [...new Set([DASHBOARD_ORIGIN, PAY_ORIGIN, LEGACY_ORIGIN])];
const MERCHANT_LIMIT_PER_MINUTE = 120; // per key

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...extra } });

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await req.text();
    if (text.length > 4000) return null;
    const v = JSON.parse(text || "{}");
    return v !== null && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

// ---------- website servers ----------

async function createDeposit(req: Request, body: Record<string, unknown>): Promise<Response> {
  const key = extractKey(req.headers.get("authorization"));
  if (!key) return json({ error: "unauthorized" }, 401);
  const d = parseDeposit(body);
  if ("error" in d) return json({ error: d.error }, 400);
  if (isCrypto(d.provider)) return await createCryptoDeposit(key, d);
  const { data, error } = await db.rpc("gw_create_deposit", {
    p_key_hash: await sha256hex(key), p_amount: d.amount, p_merchant_order_id: d.orderId, p_provider: d.provider, p_method: d.method,
    p_expires_minutes: d.expiresMinutes, p_customer_name: d.customerName, p_customer_phone: d.customerPhone,
    p_return_url: d.returnUrl, p_limit: MERCHANT_LIMIT_PER_MINUTE, p_group: d.group,
  });
  if (error) { console.error("gw_create_deposit failed", error.code); return json({ error: "could not create the order, try again" }, 500); }
  if (data?.unauthorized) return json({ error: "unauthorized" }, 401);
  if (data?.limited) return json({ error: "too many requests, try again in a minute" }, 429, { "retry-after": "60" });
  if (data?.error === "no_wallet") return json({ error: "no_wallet", message: data.message }, 409);
  if (data?.error) return json({ error: data.error }, 400);
  return json({
    tracking_number: data.tracking_number,
    pay_url: `${PAY_URL}/pay/?trackingNumber=${data.tracking_number}`,
    status: data.status, expires_at: data.expires_at, group: data.group,
  });
}

// USDT: the amount stays in taka; PayTrace converts it at the owner's rate and gives the customer an exact amount to send.
async function createCryptoDeposit(key: string, d: DepositRequest): Promise<Response> {
  const { data, error } = await db.rpc("gw_create_crypto_deposit", {
    p_key_hash: await sha256hex(key), p_amount: d.amount, p_merchant_order_id: d.orderId, p_provider: d.provider,
    p_expires_minutes: d.expiresMinutes, p_customer_name: d.customerName, p_customer_phone: d.customerPhone,
    p_return_url: d.returnUrl, p_limit: MERCHANT_LIMIT_PER_MINUTE,
  });
  if (error) { console.error("gw_create_crypto_deposit failed", error.code); return json({ error: "could not create the order, try again" }, 500); }
  if (data?.unauthorized) return json({ error: "unauthorized" }, 401);
  if (data?.limited) return json({ error: "too many requests, try again in a minute" }, 429, { "retry-after": "60" });
  if (data?.error === "no_wallet") return json({ error: "no_wallet", message: data.message }, 409);
  if (data?.error === "busy") return json({ error: "busy", message: data.message }, 503, { "retry-after": "60" });
  if (data?.error) return json({ error: data.error }, 400);
  return json({
    tracking_number: data.tracking_number,
    pay_url: `${PAY_URL}/pay/?trackingNumber=${data.tracking_number}`,
    status: data.status, expires_at: data.expires_at, crypto: data.crypto,
  });
}

async function groupsList(req: Request): Promise<Response> {
  const key = extractKey(req.headers.get("authorization"));
  if (!key) return json({ error: "unauthorized" }, 401);
  const { data, error } = await db.rpc("gw_groups_list", { p_key_hash: await sha256hex(key), p_limit: MERCHANT_LIMIT_PER_MINUTE });
  if (error) { console.error("gw_groups_list failed", error.code); return json({ error: "lookup failed, try again" }, 500); }
  if (data?.unauthorized) return json({ error: "unauthorized" }, 401);
  if (data?.limited) return json({ error: "too many requests, try again in a minute" }, 429, { "retry-after": "60" });
  return json(data?.rows ?? []);
}

async function groupCreate(req: Request, body: Record<string, unknown>): Promise<Response> {
  const key = extractKey(req.headers.get("authorization"));
  if (!key) return json({ error: "unauthorized" }, 401);
  const group = parseGroupCode(body.group);
  if (!group) return json({ error: "group must be 3 letters and 4 digits, for example dvw9166" }, 400);
  const { data, error } = await db.rpc("gw_group_create", { p_key_hash: await sha256hex(key), p_group: group, p_limit: MERCHANT_LIMIT_PER_MINUTE });
  if (error) { console.error("gw_group_create failed", error.code); return json({ error: "could not create the group, try again" }, 500); }
  if (data?.unauthorized) return json({ error: "unauthorized" }, 401);
  if (data?.limited) return json({ error: "too many requests, try again in a minute" }, 429, { "retry-after": "60" });
  if (data?.error) return json({ error: data.error }, 400);
  return json(data);
}

async function groupEnabled(req: Request, body: Record<string, unknown>): Promise<Response> {
  const key = extractKey(req.headers.get("authorization"));
  if (!key) return json({ error: "unauthorized" }, 401);
  if (typeof body.group !== "string" || !body.group.trim() || body.group.trim().length > 24) return json({ error: "group is required (max 24 characters)" }, 400);
  if (typeof body.enabled !== "boolean") return json({ error: "enabled must be true or false" }, 400);
  const { data, error } = await db.rpc("gw_group_set_enabled", {
    p_key_hash: await sha256hex(key), p_group: normalizeGroup(body.group), p_enabled: body.enabled, p_limit: MERCHANT_LIMIT_PER_MINUTE,
  });
  if (error) { console.error("gw_group_set_enabled failed", error.code); return json({ error: "could not change the group, try again" }, 500); }
  if (data?.unauthorized) return json({ error: "unauthorized" }, 401);
  if (data?.limited) return json({ error: "too many requests, try again in a minute" }, 429, { "retry-after": "60" });
  if (data?.error === "not_found") return json({ error: "group not found" }, 404);
  if (data?.error) return json({ error: data.error }, 400);
  return json(data);
}

async function orderStatus(req: Request, body: Record<string, unknown>): Promise<Response> {
  const key = extractKey(req.headers.get("authorization"));
  if (!key) return json({ error: "unauthorized" }, 401);
  const tracking = body.tracking_number === undefined ? null : isUuid(body.tracking_number) ? body.tracking_number : "bad";
  if (tracking === "bad") return json({ error: "tracking_number is not valid" }, 400);
  const orderId = typeof body.order_id === "string" || typeof body.order_id === "number" ? String(body.order_id) : null;
  if (!tracking && !orderId) return json({ error: "send tracking_number or order_id" }, 400);
  const { data, error } = await db.rpc("gw_merchant_order", {
    p_key_hash: await sha256hex(key), p_tracking: tracking, p_merchant_order_id: orderId, p_limit: MERCHANT_LIMIT_PER_MINUTE,
  });
  if (error) { console.error("gw_merchant_order failed", error.code); return json({ error: "lookup failed, try again" }, 500); }
  if (data?.unauthorized) return json({ error: "unauthorized" }, 401);
  if (data?.limited) return json({ error: "too many requests, try again in a minute" }, 429, { "retry-after": "60" });
  if (data?.error === "not_found") return json({ error: "order not found" }, 404);
  return json(data);
}

// ---------- the customer's page ----------

async function payOrder(body: Record<string, unknown>): Promise<Response> {
  if (!isUuid(body.tracking_number)) return json({ error: "not_found" }, 404);
  const { data, error } = await db.rpc("gw_order_view", { p_tracking: body.tracking_number });
  if (error) return json({ error: "try_again" }, 500);
  if (data?.error === "not_found") return json({ error: "not_found" }, 404);
  return json(data);
}

async function payPick(body: Record<string, unknown>): Promise<Response> {
  if (!isUuid(body.tracking_number)) return json({ error: "not_found" }, 404);
  const provider = typeof body.provider === "string" ? body.provider.trim().toLowerCase() : "";
  const { data, error } = await db.rpc("gw_pick_wallet", { p_tracking: body.tracking_number, p_provider: provider });
  if (error) return json({ error: "try_again" }, 500);
  if (data?.error) return json({ error: data.error }, data.error === "not_found" ? 404 : 409);
  return json(data);
}

async function paySubmit(body: Record<string, unknown>): Promise<Response> {
  if (!isUuid(body.tracking_number)) return json({ error: "not_found" }, 404);
  const trx = normalizeTrx(body.transaction_id);
  if (!trx) return json({ state: "invalid" }, 400);
  const { data, error } = await db.rpc("gw_submit_trx", { p_tracking: body.tracking_number, p_trx: trx });
  if (error) { console.error("gw_submit_trx failed", error.code); return json({ error: "try_again" }, 500); }
  const result = String(data?.result ?? "");
  const state = submitState(result);
  // A match may have just queued a result message for the website: send it now instead of waiting for the minute timer.
  if (state === "paid" || state === "review") defer(deliver());
  return json({ state });
}

// ---------- results to the websites ----------

const defer = (p: Promise<unknown>) => {
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(p);
};

async function sendOne(row: { id: number; url: string; secret: string; event: string; body: unknown }) {
  let ok = false, status = "error";
  try {
    const text = JSON.stringify({ event: row.event, data: row.body });
    const t = Math.floor(Date.now() / 1000);
    const res = await fetch(row.url, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(8000),
      headers: {
        "content-type": "application/json", "user-agent": "Deposit-Webhook/1", "x-webhook-event": row.event,
        "x-webhook-signature": await signWebhook(row.secret, t, text),
      },
      body: text,
    });
    ok = res.status >= 200 && res.status < 300;
    status = String(res.status);
    await res.body?.cancel();
  } catch (e) {
    status = e instanceof DOMException && e.name === "TimeoutError" ? "timeout" : "unreachable";
  }
  await db.rpc("gw_webhook_result", { p_id: row.id, p_ok: ok, p_status: status });
}

/** Closes unpaid orders and sends every waiting result message. Safe to call at any time and as often as you like. */
async function deliver(): Promise<void> {
  try {
    await db.rpc("gw_expire_due");
    const { data } = await db.rpc("gw_claim_webhooks", { p_limit: 20 });
    await Promise.allSettled((data ?? []).map((r: { id: number; url: string; secret: string; event: string; body: unknown }) => sendOne(r)));
  } catch (e) {
    console.error("deliver failed", e instanceof Error ? e.name : "error");
  }
}

// ---------- routing ----------

async function handle(req: Request): Promise<Response> {
  const parts = new URL(req.url).pathname.replace(/\/+$/, "").split("/");
  const route = parts.pop() ?? "";
  if (req.method === "GET" && route === "groups") return await groupsList(req);
  if (req.method !== "POST") return json({ error: "use POST (GET only for /groups)" }, 405, { allow: "POST, GET" });
  const body = await readBody(req);
  if (body === null) return json({ error: "send a JSON body" }, 400);
  switch (route) {
    case "create-deposit": return await createDeposit(req, body);
    case "groups": return await groupCreate(req, body);
    case "enabled": return parts.pop() === "groups" ? await groupEnabled(req, body) : json({ error: "unknown route" }, 404);
    case "order-status": return await orderStatus(req, body);
    case "pay-order": return await payOrder(body);
    case "pay-pick": return await payPick(body);
    case "pay-submit": return await paySubmit(body);
    case "deliver": await deliver(); return json({ ok: true });
    default: return json({ error: "unknown route" }, 404);
  }
}

// Only our own addresses (dashboard, pay page, the original address) may call the pay-* routes from a browser; the website API is server to server.
function cors(origin: string | null): Record<string, string> {
  if (!origin || !PAY_ORIGINS.includes(origin)) return {};
  return { "access-control-allow-origin": origin, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "86400", vary: "Origin" };
}

Deno.serve(async (req) => {
  const headers = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  const res = await handle(req);
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
});
