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
