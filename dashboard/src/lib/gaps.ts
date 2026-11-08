// Balance gaps (migration 063): a wallet balance that moved more than its SMS explains. Money came in or left with no
// message (bKash prints nothing for a B2B in). Pure words and arithmetic for the Phones page; no I/O here.

export interface GapRow {
  id: string;
  device_id: string;
  provider: string;
  sim_slot: number | null;
  payment_id: string;
  at: string;
  prev_at: string | null;
  amount: number | string;          // signed: + came in with no SMS, - left with no SMS
  tolerance: number | string;
  prev_balance: number | string | null;
  new_balance: number | string | null;
  explained_by: "statement" | "owner" | null;
  explained_kind: string | null;
  explained_at: string | null;
  command_id: string | null;
  note: string | null;
}

/** The float row as the view returns it since 063 (the three new columns are missing until the migration is live). */
export interface FloatFigures {
  float: number | string;
  pending_in?: number | string | null;
  pending_out?: number | string | null;
  reserved?: number | string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: number | string | null | undefined) => (v == null ? 0 : Number(v) || 0);

/** What is NOT the owner's money: the float, never below zero, plus every unexplained amount that came in. */
export const heldBack = (f: FloatFigures | undefined): number =>
  f == null ? 0 : f.reserved != null ? round2(num(f.reserved)) : round2(Math.max(num(f.float), 0) + num(f.pending_in));

/** The owner's money: balance minus what is held back. */
export const ownMoneyOf = (balance: number | string | null | undefined, f: FloatFigures | undefined): number | null =>
  balance == null ? null : round2(Number(balance) - heldBack(f));

/** A float below zero means PayTrace counted more B2B out than in: a B2B in was missed. Never shown as money. */
export function floatWarning(f: FloatFigures | undefined): string | null {
  const v = num(f?.float);
  if (v >= 0) return null;
  return `PayTrace has counted ${tkPlain(-v)} more B2B out than B2B in since the opening, so a B2B in was missed (bKash sends no SMS for one). The float is shown as 0 and nothing of it is treated as your money. Set the opening again, or mark the missed amount below.`;
}

const tkPlain = (n: number) => `Tk ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const whenDhaka = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dhaka" }) : "";

export const gapIsIn = (g: GapRow): boolean => num(g.amount) > 0;

/** One sentence for the gap row. The amount is "about" when the revealing SMS was a bKash receipt (its commission is unknown). */
export function gapLine(g: GapRow): string {
  const a = Math.abs(num(g.amount));
  const about = num(g.tolerance) > 0.01 ? "about " : "";
  const dir = gapIsIn(g) ? "came into this wallet" : "left this wallet";
  const window = g.prev_at ? `between ${whenDhaka(g.prev_at)} and ${whenDhaka(g.at)}` : `before ${whenDhaka(g.at)}`;
  const bal = g.prev_balance != null && g.new_balance != null ? ` (balance ${tkPlain(num(g.prev_balance))} to ${tkPlain(num(g.new_balance))})` : "";
  return `${about}${tkPlain(a)} ${dir} with no SMS ${window}${bal}.`;
}

/** What PayTrace is doing about it, or why it cannot. */
export function gapStatus(g: GapRow): string {
  if (g.explained_by === "statement") return `Explained by the wallet's statement: ${kindWord(g.explained_kind)}.`;
  if (g.explained_by === "owner") return `You marked it: ${kindWord(g.explained_kind)}.`;
  if (g.command_id) return "PayTrace asked the wallet's statement; if the entry was still listed, this clears by itself.";
  return gapIsIn(g) ? "Held back from your money until it is explained. Probably B2B." : "Not explained yet. Probably a cash-in or B2B the agent made.";
}

const KIND_WORD: Record<string, string> = {
  b2b_in: "B2B from the distributor", b2b_out: "B2B to the distributor", cash_in_received: "Cash In from an agent",
  cash_in_sent: "a cash-in the agent made", cash_out_sent: "a cash-out the agent made", send_money_in: "Send Money received",
  other_in: "something else that came in", other_out: "something else that left", own: "your own money", other: "something else",
};
export const kindWord = (k: string | null | undefined): string => (k && KIND_WORD[k]) || (k ? k.replace(/_/g, " ") : "unknown");

/** The choices offered for a gap of this direction (the database refuses a kind that does not fit the sign). */
export function gapChoices(g: GapRow): { kind: string; label: string }[] {
  return gapIsIn(g)
    ? [{ kind: "b2b_in", label: "It was B2B" }, { kind: "cash_in_received", label: "Cash In from an agent" }, { kind: "own", label: "My own money" }, { kind: "other", label: "Something else" }]
    : [{ kind: "b2b_out", label: "B2B to the distributor" }, { kind: "cash_in_sent", label: "A cash-in the agent made" }, { kind: "other", label: "Something else" }];
}

/** The open gaps of one wallet, newest first. */
export const openGapsOf = (gaps: GapRow[], deviceId: string, provider: string): GapRow[] =>
  gaps.filter((g) => g.device_id === deviceId && g.provider === provider && !g.explained_by).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
