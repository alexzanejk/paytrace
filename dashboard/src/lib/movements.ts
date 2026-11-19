/** Every movement of every wallet (owner 2026-11-12: "every transaction that happened in our agent should be on our
 *  transaction page ... filter by phone, bKash, Nagad, Rocket, cash out, cash in, B2B ... no transaction missed").
 *  The rows come from the server's `all_movements` (migration 097): each SMS, plus the entries of the wallet's own
 *  list (agent app reads and *247#/*167# statements) that no SMS shows, plus PayTrace's own sends nothing else shows.
 *  Pure. */

export interface Movement {
  at: string;
  exact_time: boolean;
  day: string;
  device_id: string | null;
  provider: string;
  account: string | null;
  kind: string;
  amount: number;
  commission: number | null;
  balance: number | null;
  trx_id: string | null;
  counterparty: string | null;
  status: string;
  review_reason: string | null;
  chain_status: string | null;
  seen: "sms" | "both" | "wallet" | "paytrace" | string;
  payment_id: string | null;
  raw: string | null;
  /** Who started a Cash In / Send Money (migration 105); null for every other kind. */
  mkey?: string;
  origin?: Origin | null;
  /** What on the dashboard sent it: payout | commission | cashin (the phone card's Cash In). */
  origin_ref?: string | null;
  /** The amount matches a job the partner reported (shown, but still not the dashboard's). */
  partner_job?: boolean | null;
  /** The owner's note when they marked it "I know about this". */
  ack_note?: string | null;
}

export type Origin = "dashboard" | "dashboard_likely" | "acked" | "unexpected";

/** "Started by", in words. */
export function originLabel(m: Pick<Movement, "origin" | "origin_ref" | "partner_job">): string {
  const what = m.origin_ref === "payout" ? "payout" : m.origin_ref === "commission" ? "commission payout" : m.origin_ref === "cashin" ? "Cash In button" : "";
  switch (m.origin) {
    case "dashboard": return what ? `Dashboard (${what})` : "Dashboard";
    case "dashboard_likely": return what ? `Dashboard, likely (${what})` : "Dashboard, likely";
    case "acked": return "Marked OK by you";
    case "unexpected": return m.partner_job ? "NOT from dashboard · partner job" : "NOT from dashboard";
    default: return "";
  }
}

/** The short form for the badge in a table cell (the full words are in its tooltip and in the row's details). */
export function originShort(m: Pick<Movement, "origin">): string {
  switch (m.origin) {
    case "dashboard": return "Dashboard";
    case "dashboard_likely": return "Dashboard?";
    case "acked": return "OK by you";
    case "unexpected": return "NOT dashboard";
    default: return "";
  }
}

/** What the "Started by" filter offers. */
export const ORIGIN_FILTER: { value: string; label: string }[] = [
  { value: "unexpected", label: "Not from the dashboard" },
  { value: "dashboard", label: "Started by the dashboard" },
  { value: "acked", label: "Marked OK by you" },
];

export function matchesOrigin(m: Pick<Movement, "origin">, f: string | undefined): boolean {
  if (!f || f === "all") return true;
  if (f === "dashboard") return m.origin === "dashboard" || m.origin === "dashboard_likely";
  return m.origin === f;
}

/** The kind in words. Rocket calls a customer's cash-out at the agent "B2C Cash-Out". */
export function kindLabel(kind: string, provider: string): string {
  switch (kind) {
    case "cash_out": return provider === "rocket" ? "B2C Cash Out (customer)" : "Cash Out (customer)";
    case "cash_out_sent": return "Cash Out (our own, at another agent)";
    case "cash_in_sent": return "Cash In (sent from the agent)";
    case "cash_in_received": return "Cash In (received)";
    case "b2b_in": return "B2B in";
    case "b2b_out": return "B2B out";
    case "send_money_in": return "Send Money in";
    case "send_money_out": return "Send Money out";
    case "payment_in": return "Payment in";
    case "payment_sent": return "Payment out";
    case "commission_in": return "Commission";
    case "bill_paid": return "Bill paid";
    case "loan_repaid": return "Loan repaid";
    case "other_out": return "Other (out)";
    default: return "Other (in)";
  }
}

/** The groups the Type filter offers. */
export const GROUPS: { id: string; label: string; kinds: string[] }[] = [
  { id: "cash_out", label: "Cash Out (customer, B2C)", kinds: ["cash_out"] },
  { id: "cash_in", label: "Cash In", kinds: ["cash_in_sent", "cash_in_received"] },
  { id: "b2b", label: "B2B", kinds: ["b2b_in", "b2b_out"] },
  { id: "send_money", label: "Send Money", kinds: ["send_money_in", "send_money_out"] },
  { id: "payment", label: "Payment", kinds: ["payment_in", "payment_sent"] },
  { id: "commission", label: "Commission", kinds: ["commission_in"] },
  { id: "other", label: "Other (own cash out, bills, loans)", kinds: ["cash_out_sent", "bill_paid", "loan_repaid", "other_in", "other_out"] },
];
export const groupOf = (kind: string): string => GROUPS.find((g) => g.kinds.includes(kind))?.id ?? "other";

/** Where PayTrace saw it. "wallet" = only in the wallet's own list: the wallet sent no SMS for it. */
export const SEEN_LABEL: Record<string, string> = {
  sms: "SMS",
  both: "SMS + wallet list",
  wallet: "Wallet list only (no SMS)",
  paytrace: "Sent by PayTrace",
};

export interface MovementFilter {
  device?: string;      // a phone id, or "all"
  provider?: string;    // bkash | nagad | rocket | upay | "all"
  group?: string;       // a GROUPS id, or "all"
  direction?: "in" | "out" | "all";
  seen?: string;        // a SEEN_LABEL key, or "all"
  origin?: string;      // an ORIGIN_FILTER value, or "all"
  term?: string;        // TrxID or number, any part
}

const digits = (s: string) => s.replace(/\D/g, "");

/** Does a row match a typed TrxID or number? A masked number (0171XXXX678, 017****5678) matches by its visible ends. */
export function matchesTerm(m: Movement, term: string): boolean {
  const t = term.trim().toUpperCase();
  if (!t) return true;
  if ((m.trx_id ?? "").toUpperCase().includes(t)) return true;
  const who = m.counterparty ?? "";
  if (who.toUpperCase().includes(t)) return true;
  const d = digits(t);
  if (d.length < 4) return false;
  const shown = who.replace(/[^0-9X*]/gi, "");
  if (/[X*]/i.test(shown) && d.length >= 7) {
    const head = shown.match(/^\d+/)?.[0] ?? "";
    const tail = shown.match(/\d+$/)?.[0] ?? "";
    return head.length > 0 && tail.length > 0 && d.startsWith(head) && d.endsWith(tail);
  }
  return digits(who).includes(d);
}

export function filterMovements(rows: Movement[], f: MovementFilter): Movement[] {
  return rows.filter((m) =>
    (!f.device || f.device === "all" || m.device_id === f.device) &&
    (!f.provider || f.provider === "all" || m.provider === f.provider) &&
    (!f.group || f.group === "all" || groupOf(m.kind) === f.group) &&
    (!f.direction || f.direction === "all" || (f.direction === "in" ? m.amount > 0 : m.amount < 0)) &&
    (!f.seen || f.seen === "all" || m.seen === f.seen) &&
    matchesOrigin(m, f.origin) &&
    matchesTerm(m, f.term ?? ""));
}

export interface MovementTotals { moneyIn: number; moneyOut: number; n: number; noSms: number; byGroup: Record<string, { n: number; amount: number }> }

/** Totals of what is shown. Held / ignored SMS are in the list (they happened in the wallet) and in these sums. */
export function totals(rows: Movement[]): MovementTotals {
  const t: MovementTotals = { moneyIn: 0, moneyOut: 0, n: rows.length, noSms: 0, byGroup: {} };
  for (const m of rows) {
    const a = Number(m.amount) || 0;
    if (a > 0) t.moneyIn += a; else t.moneyOut += -a;
    if (m.seen === "wallet" || m.seen === "paytrace") t.noSms++;
    const g = (t.byGroup[groupOf(m.kind)] ??= { n: 0, amount: 0 });
    g.n++;
    g.amount += a;
  }
  t.moneyIn = Math.round(t.moneyIn * 100) / 100;
  t.moneyOut = Math.round(t.moneyOut * 100) / 100;
  return t;
}

/** At most 31 days a read (the server's limit); a longer period shows its last 31 days. */
export function clampRange(from: string, to: string): { from: string; to: string; clamped: boolean } {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  if (ms <= 31 * 86_400_000) return { from, to, clamped: false };
  const start = new Date(Date.parse(`${to}T00:00:00Z`) - 31 * 86_400_000).toISOString().slice(0, 10);
  return { from: start, to, clamped: true };
}
