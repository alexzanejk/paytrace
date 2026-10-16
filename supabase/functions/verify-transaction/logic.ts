// Pure helpers for the verify-transaction endpoint (no I/O, so they can be unit tested).

export const PROVIDERS = ["bkash", "nagad", "rocket", "upay"] as const;

/** Keys are listed in the VERIFY_API_KEYS secret, separated by commas (one per website server, so each can be
 *  replaced on its own). Anything shorter than 32 characters is ignored: a weak key must not work. */
export function parseKeys(env: string | undefined | null): string[] {
  return (env ?? "").split(",").map((k) => k.trim()).filter((k) => k.length >= 32);
}

function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

/** The matching key, or null. Checks every key (no early exit), so timing does not reveal which one was close. */
export function authenticate(header: string | null | undefined, keys: string[]): string | null {
  const supplied = (header ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!supplied) return null;
  let hit: string | null = null;
  for (const k of keys) if (safeEqual(supplied, k)) hit = k;
  return hit;
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
