// Pure helpers for the gateway function (no I/O, so they can be unit tested).

export const PROVIDERS = ["bkash", "nagad", "rocket", "upay"] as const;
/** Crypto deposits: the amount is in taka, the customer pays USDT on that network. */
export const CRYPTO_PROVIDERS = ["usdt_bep20", "usdt_trc20"] as const;
export const isCrypto = (provider: string): boolean => (CRYPTO_PROVIDERS as readonly string[]).includes(provider);

/** Same key shape the dashboard makes (API access page). Junk is turned away before any database work. */
export const KEY_PATTERN = /^ptk_[0-9a-f]{64}$/;

export function extractKey(header: string | null | undefined): string | null {
  const supplied = (header ?? "").trim().replace(/^Bearer\s+/i, "").trim();
  return KEY_PATTERN.test(supplied) ? supplied : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** A TrxID as the customer types it: spaces and lower case tidied. null = cannot be a TrxID. */
export function normalizeTrx(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, "").toUpperCase();
  return /^[A-Z0-9]{6,40}$/.test(t) ? t : null;
}

export interface DepositRequest {
  amount: number;
  orderId: string;
  provider: string;
  method: string | null;
  returnUrl: string | null;
  expiresMinutes: number | null;
  customerName: string | null;
  customerPhone: string | null;
  /** Wallet group asked for ("main" when left out). The database decides whether it can be used. */
  group: string;
}

/** A wallet group as the website sends it: up to 24 characters, "main" or the partner's link code (3 lowercase letters + 4 digits, like dvw9166). Case does not matter. */
export function parseGroup(v: unknown): string | { error: string } {
  if (v === undefined || v === null || v === "") return "main";
  if (typeof v !== "string" || v.trim().length > 24) return { error: "group must be text of at most 24 characters (or leave it out)" };
  return normalizeGroup(v);
}

/** Group names are always lower case ("main", or a code like dvw9166). */
export function normalizeGroup(v: string): string {
  const t = v.trim();
  return t === "" ? "main" : t.toLowerCase();
}

/** The partner's link code: exactly 3 letters and 4 digits (any case in, lower case out). null = not a valid code. */
export function parseGroupCode(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  return /^[a-z]{3}[0-9]{4}$/.test(t) ? t : null;
}

/** Reads the body of "create a deposit". Returns a message the developer can act on when something is wrong. */
export function parseDeposit(body: Record<string, unknown>): DepositRequest | { error: string } {
  const a = body.amount;
  const amount = typeof a === "number" ? a : typeof a === "string" && /^\d{1,7}(\.\d{1,2})?$/.test(a.trim()) ? Number(a.trim()) : NaN;
  if (!Number.isFinite(amount) || amount <= 0) return { error: "amount is required, for example 500 or 500.50" };
  const orderId = typeof body.order_id === "string" ? body.order_id.trim() : typeof body.order_id === "number" ? String(body.order_id) : "";
  if (orderId.length < 1 || orderId.length > 100) return { error: "order_id is required (your own order number, 1 to 100 characters)" };
  // The website's own page lets the customer choose the method, so the provider is required here.
  const p = typeof body.provider === "string" ? body.provider.trim().toLowerCase() : "";
  if (!(PROVIDERS as readonly string[]).includes(p) && !isCrypto(p)) return { error: "provider is required: bkash, nagad, rocket, upay, usdt_bep20 or usdt_trc20" };
  const provider = p;
  let method: string | null = null;
  if (body.method !== undefined && body.method !== null && body.method !== "") {
    const m = typeof body.method === "string" ? body.method.trim().toLowerCase() : "";
    if (m !== "send_money" && m !== "cash_out") return { error: "method must be send_money or cash_out (or leave it out)" };
    method = m;
  }
  let returnUrl: string | null = null;
  if (body.return_url !== undefined && body.return_url !== null && body.return_url !== "") {
    if (typeof body.return_url !== "string" || !/^https:\/\/[^\s]{3,480}$/.test(body.return_url)) return { error: "return_url must be an https address" };
    returnUrl = body.return_url;
  }
  let expiresMinutes: number | null = null;
  if (body.expires_in_minutes !== undefined && body.expires_in_minutes !== null) {
    const m = Number(body.expires_in_minutes);
    if (!Number.isInteger(m) || m < 3 || m > 60) return { error: "expires_in_minutes must be a whole number from 3 to 60" };
    expiresMinutes = m;
  }
  const group = parseGroup(body.group);
  if (typeof group === "object") return group;
  const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  return { amount, orderId, provider, method, returnUrl, expiresMinutes, customerName: text(body.customer_name, 80), customerPhone: text(body.customer_phone, 20), group };
}

/** What the customer's page should do after sending a TrxID. The page words these itself (English and Bangla). */
export type SubmitState = "paid" | "checking" | "review" | "used" | "expired" | "too_many" | "wrong_method" | "invalid" | "closed";

export function submitState(result: string): SubmitState {
  switch (result) {
    case "matched":
    case "already_paid":
      return "paid";
    case "waiting_for_payment":
      return "checking";
    case "review":
      return "review";
    case "payment_already_used":
    case "trx_already_claimed":
      return "used";
    case "expired":
      return "expired";
    case "too_many_attempts":
      return "too_many";
    case "tracked_only":
      return "wrong_method"; // a Cash Out receipt on a Send Money order (or the other way round)
    case "invalid_input":
    case "choose_provider":
      return "invalid";
    case "cancelled":
    case "order_not_found":
      return "closed";
    default:
      return "checking";
  }
}

/** The signature a website checks: HMAC-SHA256 over "<timestamp>.<body>", sent as `t=<timestamp>,v1=<hex>`. */
export async function signWebhook(secret: string, timestamp: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${timestamp},v1=${hex}`;
}

/** How long to wait before the next try, in minutes (the database applies the same schedule). */
export const WEBHOOK_BACKOFF_MIN = [1, 5, 15, 60, 180, 360, 720] as const;
