/** The wallet ledger (migration 059): every transaction of one phone's wallet in time order, from the SMS PayTrace
 *  stored and from the wallet's own statement. Pure helpers, tested in tests/ledger.test.ts (no imports, so the test
 *  runner can load it). The rows come from the database function wallet_ledger. */

export interface LedgerRow {
  sort_at: string;
  /** true = the time comes from an SMS; false = a statement-only line placed between its neighbours. */
  exact_time: boolean;
  day: string;
  kind: string;
  /** The wallet's own words for a statement line; the kind for an SMS row. */
  label: string;
  /** Signed: + came in, - left the wallet. */
  amount: number | string;
  balance: number | string | null;
  trx_id: string | null;
  status: string | null;
  review_reason: string | null;
  chain_status: string | null;
  source: "sms" | "both" | "statement";
  raw: string | null;
  payment_id: string | null;
  sim_slot: number | null;
  counterparty: string | null;
}

/** Plain words per kind. `in` = money came into the wallet. */
export const KIND_WORDS: Record<string, { label: string; in: boolean }> = {
  cash_out: { label: "Cash Out (customer paid in)", in: true },
  send_money_in: { label: "Send Money received", in: true },
  payment_in: { label: "Payment received", in: true },
  cash_in_received: { label: "Cash In received (from an agent)", in: true },
  b2b_in: { label: "B2B in (from the distributor)", in: true },
  commission_in: { label: "Commission", in: true },
  other_in: { label: "Other (money in)", in: true },
  b2b_out: { label: "B2B OUT (to the distributor)", in: false },
  cash_in_sent: { label: "Cash In paid out", in: false },
  cash_out_sent: { label: "Own cash-out at an agent", in: false },
  payment_sent: { label: "Payment made", in: false },
  bill_paid: { label: "Bill paid", in: false },
  loan_repaid: { label: "Loan repaid", in: false },
  send_money_out: { label: "Send Money sent", in: false },
  other_out: { label: "Other (money out)", in: false },
};

export const kindLabel = (kind: string, label?: string | null): string =>
  KIND_WORDS[kind]?.label ?? (label && label !== kind ? label : kind.replace(/_/g, " "));

export const isIn = (kind: string, amount: number | string): boolean =>
  KIND_WORDS[kind] ? KIND_WORDS[kind].in : Number(amount) >= 0;

export const SOURCE_WORDS: Record<LedgerRow["source"], string> = {
  sms: "SMS",
  both: "SMS + statement",
  statement: "Statement only (no SMS)",
};

/** The default window: today and the two days before it, Bangladesh time. */
export function defaultRange(now: Date = new Date()): { from: string; to: string } {
  const dhaka = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });
  return { from: dhaka(new Date(now.getTime() - 2 * 864e5)), to: dhaka(now) };
}

/** "pick at most 31 days" is the database rule; the page says it first. */
export function rangeProblem(from: string, to: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return "Pick both dates.";
  if (to < from) return "The end date is before the start date.";
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 864e5);
  if (days > 31) return "Pick at most 31 days at a time.";
  return null;
}

/** Rows grouped by Bangladesh day, newest day first, newest row first inside a day (like the wallet apps). */
export function groupByDay(rows: LedgerRow[]): { day: string; rows: LedgerRow[]; in: number; out: number }[] {
  const days = new Map<string, LedgerRow[]>();
  for (const r of rows) {
    const list = days.get(r.day) ?? [];
    list.push(r);
    days.set(r.day, list);
  }
  return [...days.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, list]) => {
      const sorted = [...list].sort((a, b) => (a.sort_at < b.sort_at ? 1 : a.sort_at > b.sort_at ? -1 : 0));
      let inn = 0, out = 0;
      for (const r of sorted) {
        const n = Number(r.amount);
        if (n >= 0) inn += n; else out += -n;
      }
      return { day, rows: sorted, in: round2(inn), out: round2(out) };
    });
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** How many statement-only rows (an SMS never came) and how many SMS rows the statement vouched for. */
export function ledgerCounts(rows: LedgerRow[]): { smsOnly: number; both: number; statementOnly: number } {
  let smsOnly = 0, both = 0, statementOnly = 0;
  for (const r of rows) {
    if (r.source === "sms") smsOnly++;
    else if (r.source === "both") both++;
    else statementOnly++;
  }
  return { smsOnly, both, statementOnly };
}

/** CSV rows (header first). Numbers stay numbers; the page's csv helper makes the cells formula-safe. */
export function ledgerCsv(rows: LedgerRow[]): unknown[][] {
  const header = ["Time (Dhaka)", "Exact time", "Kind", "Wallet's words", "Amount", "Balance after", "TrxID", "Status", "Source", "SIM"];
  const body = rows.map((r) => [
    new Date(r.sort_at).toLocaleString("en-GB", { timeZone: "Asia/Dhaka", hour12: false }),
    r.exact_time ? "yes" : "between neighbours",
    kindLabel(r.kind),
    r.label === r.kind ? "" : r.label,
    Number(r.amount),
    r.balance == null ? "" : Number(r.balance),
    r.trx_id ?? "",
    r.status ?? "",
    SOURCE_WORDS[r.source] ?? r.source,
    r.sim_slot == null ? "" : `SIM ${r.sim_slot + 1}`,
  ]);
  return [header, ...body];
}

// ---------- the B2B float ----------

export interface B2BFloatRow {
  device_id: string;
  provider: string;
  opening: number | string;
  opening_at: string | null;
  b2b_in: number | string;
  b2b_out: number | string;
  float: number | string;
  last_out_at: string | null;
  last_out_amount: number | string | null;
  last_in_at: string | null;
  // Since migration 063 (missing until it is live): unexplained ins / outs, and what is held back from "your money".
  pending_in?: number | string | null;
  pending_out?: number | string | null;
  reserved?: number | string | null;
}

/** balance - float, never shown below zero as "yours" (a float set too high only means no job starts). */
export const ownMoney = (balance: number | string | null | undefined, float: number | string | null | undefined): number | null =>
  balance == null ? null : round2(Number(balance) - Number(float ?? 0));

/** A B2B OUT in the last 24 hours is the thing the owner wants to see at once. */
export const recentB2BOut = (row: B2BFloatRow | undefined, now: number = Date.now()): boolean =>
  !!row?.last_out_at && now - Date.parse(row.last_out_at) < 24 * 3600_000;

/** The amount typed for the opening B2B float: digits, commas, Bangla digits; 0 to 10,000,000. */
export function parseOpening(text: string): number | null {
  const bn = "\u09e6\u09e7\u09e8\u09e9\u09ea\u09eb\u09ec\u09ed\u09ee\u09ef";
  const ascii = text.replace(/[\u09e6-\u09ef]/g, (c) => String(bn.indexOf(c))).replace(/[,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(ascii)) return null;
  const n = Number(ascii);
  return n >= 0 && n <= 10_000_000 ? n : null;
}
