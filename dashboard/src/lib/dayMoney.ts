// The phone card's day totals (migration 065, owner 2026-11-08: "on every phone card 12am to 11:59pm total cashout and
// cashin 100% accurately and clearly, and for personal sent and received"). The database counts each movement once
// (device_day_money); this file only words it. No I/O.

export interface DayMoneyRow {
  device_id: string;
  provider: string;
  account: "agent" | "personal" | "unknown";
  sim_slot: number | null;
  cash_out_n: number; cash_out: number | string;
  cash_in_n: number; cash_in: number | string;
  b2b_in_n: number; b2b_in: number | string;
  b2b_out_n: number; b2b_out: number | string;
  received_n: number; received: number | string;
  sent_n: number; sent: number | string;
  held_n: number; held: number | string;
  unknown_sim_n: number;
  from_sms: number; from_statement: number; from_paytrace: number;
  gap_open_n: number; gap_open: number | string;
  checked: boolean;
}

const num = (v: number | string | null | undefined) => (v == null ? 0 : Number(v) || 0);
const WALLET: Record<string, string> = { bkash: "bKash", nagad: "Nagad", rocket: "Rocket", upay: "Upay" };

export const accountTitle = (r: DayMoneyRow): string =>
  `${WALLET[r.provider] ?? r.provider} ${r.account === "personal" ? "personal" : r.account === "agent" ? "agent" : "(SIM not known)"}` +
  (r.sim_slot != null ? ` · SIM ${r.sim_slot + 1}` : "");

export interface Figure { label: string; n: number; amount: number; tone: "in" | "out" }

/** The figures that matter for this account: an agent's Cash Out (money in) and Cash In (money out), B2B when there was
 *  any; a personal account's Received and Sent. Zero lines are left out except the two headline ones. */
export function figures(r: DayMoneyRow): Figure[] {
  const out: Figure[] = [];
  if (r.account !== "personal") {
    out.push({ label: "Cash Out (money in)", n: r.cash_out_n, amount: num(r.cash_out), tone: "in" });
    out.push({ label: "Cash In (money out)", n: r.cash_in_n, amount: num(r.cash_in), tone: "out" });
    if (r.b2b_in_n) out.push({ label: "B2B in", n: r.b2b_in_n, amount: num(r.b2b_in), tone: "in" });
    if (r.b2b_out_n) out.push({ label: "B2B out", n: r.b2b_out_n, amount: num(r.b2b_out), tone: "out" });
    if (r.received_n) out.push({ label: "Received", n: r.received_n, amount: num(r.received), tone: "in" });
    if (r.sent_n) out.push({ label: "Sent", n: r.sent_n, amount: num(r.sent), tone: "out" });
  } else {
    out.push({ label: "Received", n: r.received_n, amount: num(r.received), tone: "in" });
    out.push({ label: "Sent", n: r.sent_n, amount: num(r.sent), tone: "out" });
    if (r.cash_out_n) out.push({ label: "Cash Out received", n: r.cash_out_n, amount: num(r.cash_out), tone: "in" });
  }
  return out;
}

export type CheckTone = "ok" | "warn" | "idle";

/** The day check in one line: everything the wallet's balance did that day is accounted for, or how much is not. */
export function checkLine(r: DayMoneyRow): { text: string; tone: CheckTone } {
  if (!r.checked) return { text: "Not checked: the balance check runs from 8 Nov 2026.", tone: "idle" };
  if (r.account === "unknown") {
    return { text: `${r.unknown_sim_n} message${r.unknown_sim_n === 1 ? "" : "s"} did not say which SIM, so they cannot be put under the agent or the personal account. Update the app on this phone.`, tone: "warn" };
  }
  const g = num(r.gap_open);
  if (r.gap_open_n > 0) {
    const dir = g >= 0 ? "came in" : "left";
    return { text: `Tk ${Math.abs(g).toLocaleString("en-IN", { maximumFractionDigits: 2 })} ${dir} with no SMS and is not accounted for yet (${r.gap_open_n} gap${r.gap_open_n === 1 ? "" : "s"}; see B2B money below).`, tone: "warn" };
  }
  return { text: "All accounted for ✓ — every balance change today is explained.", tone: "ok" };
}

/** Where the figures came from, so a number is never a mystery. */
export function sourceLine(r: DayMoneyRow): string {
  const parts: string[] = [];
  if (r.from_sms) parts.push(`${r.from_sms} from SMS`);
  if (r.from_statement) parts.push(`${r.from_statement} from the wallet's statement`);
  if (r.from_paytrace) parts.push(`${r.from_paytrace} sent by PayTrace`);
  const held = r.held_n ? ` · ${r.held_n} held for review (Tk ${num(r.held).toLocaleString("en-IN")}) not counted` : "";
  return (parts.length ? parts.join(" · ") : "nothing yet") + held;
}

/** Rows of one phone, agent before personal, wallet by wallet. */
export const rowsOf = (rows: DayMoneyRow[], deviceId: string): DayMoneyRow[] =>
  rows.filter((r) => r.device_id === deviceId).sort((a, b) => a.provider.localeCompare(b.provider) || a.account.localeCompare(b.account));

// ---- Is the day complete? (migration 069, owner 2026-11-08: "one single accurate data, no missing data") ----
// device_day_check proves a day by the balance itself: every change of the wallet's printed balance between the last
// reading before 12:00 AM and the first one after 11:59 PM must be an SMS, an entry in the wallet's statement or a cash-in
// PayTrace made. What is left over is shown in taka, with when it happened.

export type DayState = "complete" | "missing" | "waiting" | "running" | "reading_differs" | "no_data";

export interface DayCheckRow {
  device_id: string;
  provider: string;
  account: "agent" | "personal";
  sim_slot: number | null;
  opening: number | string | null; opening_at: string | null;
  closing: number | string | null; closing_at: string | null;
  next_at: string | null;
  reading: number | string | null; reading_at: string | null;
  gap_open_n: number; gap_open: number | string; gap_from: string | null; gap_to: string | null;
  gap_explained_n: number;
  state: DayState;
}

export interface DayBlock { key: string; provider: string; account: string; money: DayMoneyRow | null; check: DayCheckRow | null }

/** One block per account: the day's figures and its check side by side (either may be missing: a quiet wallet has a
 *  balance but no movement, an account the SIM cannot be told for has movements but no check). */
export function dayBlocks(money: DayMoneyRow[], checks: DayCheckRow[]): DayBlock[] {
  const m = new Map<string, DayBlock>();
  const key = (p: string, a: string) => `${p}:${a}`;
  for (const r of money) m.set(key(r.provider, r.account), { key: key(r.provider, r.account), provider: r.provider, account: r.account, money: r, check: null });
  for (const c of checks) {
    const k = key(c.provider, c.account);
    const b = m.get(k);
    if (b) b.check = c;
    else m.set(k, { key: k, provider: c.provider, account: c.account, money: null, check: c });
  }
  const rank = (a: string) => (a === "agent" ? 0 : a === "personal" ? 1 : 2);
  return [...m.values()].sort((a, b) => a.provider.localeCompare(b.provider) || rank(a.account) - rank(b.account));
}

const takaText = (n: number) => "Tk " + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "8 Nov, 1:20 PM" in Bangladesh time. */
export function dhakaTime(iso: string | null): string {
  if (!iso) return "?";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "?";
  return d.toLocaleString("en-GB", { timeZone: "Asia/Dhaka", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\b(am|pm)\b/i, (x) => x.toUpperCase());
}

/** The balance the day started and ended with, in one line. */
export function balanceLine(c: DayCheckRow, today: boolean): string {
  const open = c.opening == null ? null : num(c.opening);
  const close = c.closing == null ? null : num(c.closing);
  if (open == null && close == null) return "No balance seen yet.";
  if (close == null) return `Balance ${takaText(open!)} all day (no message with a balance${today ? " yet" : ""}).`;
  const end = today ? "now" : "ended at";
  return open == null ? `Balance ${end} ${takaText(close)}.` : `Started at ${takaText(open)}, ${end} ${takaText(close)}.`;
}

/** The verdict in one line. */
export function stateLine(c: DayCheckRow): { text: string; tone: CheckTone } {
  const found = c.gap_explained_n
    ? ` ${c.gap_explained_n} move${c.gap_explained_n === 1 ? "" : "s"} with no SMS ${c.gap_explained_n === 1 ? "was" : "were"} found in the wallet's statement.`
    : "";
  switch (c.state) {
    case "complete":
      return { text: `Complete ✓ — every balance change of the day is accounted for.${found}`, tone: "ok" };
    case "running":
      return { text: `Day still running. So far every balance change is accounted for ✓${found}`, tone: "ok" };
    case "missing": {
      const g = num(c.gap_open);
      const dir = g >= 0 ? "came in" : "left the wallet";
      return {
        text: `Tk ${Math.abs(g).toLocaleString("en-IN", { maximumFractionDigits: 2 })} ${dir} with no SMS between ${dhakaTime(c.gap_from)} and ${dhakaTime(c.gap_to)}, and it is not in the wallet's statement yet. The phone reads its statement again by itself; if it is B2B or your own money, mark it under B2B money below.`,
        tone: "warn",
      };
    }
    case "reading_differs": {
      const d = num(c.reading) - num(c.closing ?? c.opening);
      return {
        text: `A balance check at ${dhakaTime(c.reading_at)} read ${takaText(num(c.reading))}, Tk ${Math.abs(d).toLocaleString("en-IN", { maximumFractionDigits: 2 })} ${d >= 0 ? "more" : "less"} than the last message said. The next message from the wallet will show where it went.`,
        tone: "warn",
      };
    }
    case "waiting":
      return { text: "Day finished. Waiting for the first balance after midnight to confirm the closing balance (the phone checks it shortly after 12 AM).", tone: "idle" };
    default:
      return { text: "No balance seen yet.", tone: "idle" };
  }
}

/** The phone card's headline: the merged Cash Out and Received of all its accounts (null when the day's rows failed to load). */
export function dayTotals(rows: DayMoneyRow[]): { cashOut: { n: number; amount: number }; received: { n: number; amount: number } } {
  const t = { cashOut: { n: 0, amount: 0 }, received: { n: 0, amount: 0 } };
  for (const r of rows) {
    t.cashOut.n += r.cash_out_n; t.cashOut.amount += num(r.cash_out);
    t.received.n += r.received_n; t.received.amount += num(r.received);
  }
  t.cashOut.amount = Math.round(t.cashOut.amount * 100) / 100;
  t.received.amount = Math.round(t.received.amount * 100) / 100;
  return t;
}
