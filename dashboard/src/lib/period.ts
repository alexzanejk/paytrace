// Dates and totals for the dashboard. Pure functions, no I/O, so they can be unit tested on their own.
// A "day" is a Bangladesh calendar day: 12:00 AM to 11:59 PM in Asia/Dhaka, wherever the viewer is.

export const dhakaDay = (d: Date = new Date()): string => d.toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });

/** Adds (or subtracts) whole days to a "YYYY-MM-DD" date. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The exact moment a Bangladesh day starts, as a UTC ISO string. */
export const dayStartIso = (day: string): string => new Date(`${day}T00:00:00+06:00`).toISOString();

export type PeriodId = "today" | "yesterday" | "7d" | "30d" | "custom";

export const PERIODS: { id: PeriodId; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "custom", label: "Pick dates" },
];

export interface DayRange {
  from: string; // inclusive, YYYY-MM-DD
  to: string; // inclusive
}

export function periodRange(id: PeriodId, custom: DayRange, now: Date = new Date()): DayRange {
  const today = dhakaDay(now);
  switch (id) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    default: {
      const from = custom.from || today;
      const to = custom.to || from;
      return from <= to ? { from, to } : { from: to, to: from };
    }
  }
}

/** [start, end) of a range as UTC ISO strings, for filtering timestamps. */
export const rangeBounds = (r: DayRange) => ({ startIso: dayStartIso(r.from), endIso: dayStartIso(addDays(r.to, 1)) });

/** "18 Oct 2026" for a YYYY-MM-DD date. */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    timeZone: "UTC", day: "2-digit", month: "short", year: "numeric",
  });
}

export function rangeLabel(r: DayRange): string {
  return r.from === r.to ? dayLabel(r.from) : `${dayLabel(r.from)} – ${dayLabel(r.to)}`;
}

// ---------- totals ----------

export interface DayTotal {
  day: string;
  device_id: string | null;
  provider: string;
  txn_type: string;
  status: string;
  n: number;
  amount: number;
  fee: number;
  commission: number;
}

/** Statuses that count as real money in the totals. Payments held for review (could be fake SMS) and ignored ones do not. */
export const COUNTED_STATUSES = ["unmatched", "matched", "tracked_only"];
export const isCounted = (status: string) => COUNTED_STATUSES.includes(status);

export const isIncoming = (type: string) => type === "payment_received" || type === "send_money_received";

export interface Sum {
  n: number;
  amount: number;
  fee: number;
  commission: number;
}

const empty = (): Sum => ({ n: 0, amount: 0, fee: 0, commission: 0 });

function add(into: Sum, r: DayTotal) {
  into.n += Number(r.n) || 0;
  into.amount += Number(r.amount) || 0;
  into.fee += Number(r.fee) || 0;
  into.commission += Number(r.commission) || 0;
}

export interface Summary {
  received: Sum;
  cashOut: Sum;
  commission: number;
}

/** Received (payments + send money) and cash-out totals for the counted rows. */
export function summarize(rows: DayTotal[]): Summary {
  const received = empty();
  const cashOut = empty();
  let commission = 0;
  for (const r of rows) {
    if (!isCounted(r.status)) continue;
    if (isIncoming(r.txn_type)) add(received, r);
    else if (r.txn_type === "cash_out") add(cashOut, r);
    commission += Number(r.commission) || 0;
  }
  return { received, cashOut, commission };
}

/** Totals grouped by any key (a phone, a provider, a day…), counted rows only. */
export function groupSummary(rows: DayTotal[], key: (r: DayTotal) => string): Map<string, Summary> {
  const buckets = new Map<string, DayTotal[]>();
  for (const r of rows) {
    const k = key(r);
    const list = buckets.get(k);
    if (list) list.push(r);
    else buckets.set(k, [r]);
  }
  return new Map([...buckets].map(([k, list]) => [k, summarize(list)]));
}
