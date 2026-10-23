// Partner commission: pure helpers (no I/O) so they can be unit tested on their own.
// A partner is a person whose phone/account (bKash, Nagad, Rocket, Upay; agent = Cash Out, personal = Send Money) receives
// money for the business. The owner sets a % per phone, per provider and per kind; commission is that % of the day's total.
// PayTrace only records this. The owner pays partners outside the system and records the payout.
// Same four providers as the database check on commission_rates (kept here so this file has no imports and tests run on their own).
const PROVIDERS = ["bkash", "nagad", "rocket", "upay"] as const;

export const KINDS = ["cash_out", "send_money"] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_LABEL: Record<Kind, string> = {
  cash_out: "Cash Out (agent account)",
  send_money: "Send Money (personal account)",
};

export interface RateRow {
  device_id: string;
  provider: string;
  kind: Kind;
  rate_pct: number;
  effective_from: string; // YYYY-MM-DD, a Bangladesh day
}

export interface CommissionDay {
  day: string;
  device_id: string;
  provider: string;
  kind: Kind;
  n: number;
  total: number;
  rate_pct: number | null;
  commission: number;
}

export interface Payout {
  id: string;
  device_id: string;
  amount: number;
  paid_on: string;
  note: string | null;
  created_at: string;
  voided_at: string | null;
}

export interface CommissionBalance {
  device_id: string;
  earned: number;
  paid: number;
}

export const rateKey = (provider: string, kind: string) => `${provider}|${kind}`;

/** The rate in force on `day` for each provider+kind of one phone: the newest rate that starts on or before that day. */
export function ratesOn(rows: RateRow[], deviceId: string, day: string): Map<string, number> {
  const best = new Map<string, RateRow>();
  for (const r of rows) {
    if (r.device_id !== deviceId || r.effective_from > day) continue;
    const k = rateKey(r.provider, r.kind);
    const cur = best.get(k);
    if (!cur || r.effective_from > cur.effective_from) best.set(k, r);
  }
  return new Map([...best].map(([k, r]) => [k, Number(r.rate_pct)]));
}

/** Same rule as the database: a number such as 4 or 4.5, at most 3 digits before and 2 after the point, not above 100. */
export function parseRate(text: string): { ok: true; value: number } | { ok: false } {
  const t = text.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return { ok: false };
  const value = Number(t);
  return value >= 0 && value <= 100 ? { ok: true, value } : { ok: false };
}

/** "4%" or "4.5%" */
export const fmtPct = (n: number) => `${Number(n.toFixed(2))}%`;

/** The commission on a total at a rate, rounded to 2 decimals like the database does. */
export const commissionOf = (total: number, ratePct: number) => Math.round(total * ratePct) / 100;

/** What the grid sends to the server: only the cells that were typed, are valid and differ from the rate now in force.
 *  A blank cell means "leave as it is" (type 0 to stop commission on something). */
export function changedRates(
  current: Map<string, number>,
  typed: Record<string, string>,
): { changes: { provider: string; kind: Kind; rate: string }[]; invalid: string[] } {
  const changes: { provider: string; kind: Kind; rate: string }[] = [];
  const invalid: string[] = [];
  for (const provider of PROVIDERS) {
    for (const kind of KINDS) {
      const key = rateKey(provider, kind);
      const text = (typed[key] ?? "").trim();
      if (text === "") continue;
      const p = parseRate(text);
      if (!p.ok) {
        invalid.push(key);
        continue;
      }
      if (current.get(key) !== p.value) changes.push({ provider, kind, rate: String(p.value) });
    }
  }
  return { changes, invalid };
}

/** Totals over some daily rows. */
export function sumDays(rows: Pick<CommissionDay, "total" | "commission" | "n">[]) {
  let total = 0, commission = 0, n = 0;
  for (const r of rows) {
    total += Number(r.total);
    commission += Number(r.commission);
    n += Number(r.n);
  }
  return { total: Math.round(total * 100) / 100, commission: Math.round(commission * 100) / 100, n };
}

/** What is still owed to a partner. Never below zero in the display, but an overpayment is reported as `over`. */
export function owedOf(earned: number, paid: number) {
  const diff = Math.round((Number(earned) - Number(paid)) * 100) / 100;
  return { owed: Math.max(0, diff), over: Math.max(0, -diff) };
}
