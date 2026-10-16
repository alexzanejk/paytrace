// Pure helpers for the verify-transaction endpoint (no I/O, so they can be unit tested).

export const PROVIDERS = ["bkash", "nagad", "rocket", "upay"] as const;

/** Keys are made on the dashboard's API access page and look like ptk_ + 64 hex characters. */
export const KEY_PATTERN = /^ptk_[0-9a-f]{64}$/;

/** The key from an "Authorization: Bearer ptk_..." header, or null if it is missing or cannot be one of ours. Junk is
 *  turned away here, before any database work. */
export function extractKey(header: string | null | undefined): string | null {
  const supplied = (header ?? "").trim().replace(/^Bearer\s+/i, "").trim();
  return KEY_PATTERN.test(supplied) ? supplied : null;
}

/** What customers type is tidied (spaces, lower case) the same way the server stores IDs. Anything that cannot be a
 *  transaction ID returns null, and the caller answers "not found". */
export function normalizeTrx(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toUpperCase();
  return /^[A-Z0-9]{6,40}$/.test(t) ? t : null;
}

/** undefined = no provider given (search all). null = a provider was given but it is not one we know. */
export function normalizeProvider(v: unknown): string | undefined | null {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") return null;
  const p = v.trim().toLowerCase();
  return (PROVIDERS as readonly string[]).includes(p) ? p : null;
}

/** The amount a customer says they paid, as a number. undefined = none given, null = given but not a usable amount. */
export function normalizeAmount(v: unknown): number | undefined | null {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,12}([.,]\d{1,2})?$/.test(v.trim()) ? Number(v.trim().replace(",", ".")) : NaN;
  return Number.isFinite(n) && n > 0 && n < 1e10 ? n : null;
}

/** Equal to the paisa: 500, 500.0 and "500.00" all match a stored 500.00, but 500.01 does not. */
export function amountsEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}
