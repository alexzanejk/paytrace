// Payouts (migration 065, owner 2026-11-08): the owner ticks transactions, keeps a share (20% by default) and sends the
// rest to a number they type or paste. Pure words, arithmetic and checks for the Payout page; the database repeats every
// rule (create_payout / manual_payout), so nothing here is the only guard. No I/O.

/** The same folding as lib/walletNumbers (kept here so this file has no imports and runs in the node tests). */
function normalizeBdNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (/^8801[0-9]{9}$/.test(d)) d = "0" + d.slice(3);
  return /^01[0-9]{9}$/.test(d) ? d : null;
}

export type PayoutStatus = "sending" | "paid" | "unsure" | "failed" | "cancelled";
export type PayoutMethod = "cash_in" | "send_money" | "manual";

export interface PayoutRow {
  id: string;
  method: PayoutMethod;
  status: PayoutStatus;
  device_id: string | null;
  provider: string | null;
  from_account: "agent" | "personal" | null;
  to_number: string | null;
  total_amount: number | string;
  keep_pct: number | string;
  keep_amount: number | string;
  send_amount: number | string;
  command_id: string | null;
  trx_id: string | null;
  balance_after: number | string | null;
  error: string | null;
  note: string | null;
  created_at: string;
  paid_at: string | null;
}

export interface PayoutItemRow {
  payout_id: string;
  payment_id: string;
  amount: number | string;
  live: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: number | string | null | undefined) => (v == null ? 0 : Number(v) || 0);

/** The same split as the database's payout_split: whole taka sent, the rest kept (80% of Tk 497 sends Tk 397). */
export function splitPayout(total: number, keepPct: number): { keep: number; send: number } {
  const keep2 = round2((total * keepPct) / 100);
  const send = Math.max(0, Math.floor(round2(total - keep2) + 1e-9));
  return { keep: round2(total - send), send };
}

/** A typed keep share: 0 to 100, up to two decimals; null when it is not one. */
export function parsePct(text: string): number | null {
  const t = text.replace(/[%\s]/g, "");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n >= 0 && n <= 100 ? n : null;
}

/** "01612667190" -> "0161 266 7190", easy to read back before sending. */
export const groupDigits = (n: string): string => (n.length === 11 ? `${n.slice(0, 4)} ${n.slice(4, 7)} ${n.slice(7)}` : n);

/** The receiving number, typed twice (owner 2026-11-08: typed or pasted, never picked from a list, so a second entry has to
 *  catch a typo). Returns the number when both are the same Bangladesh mobile number, else the reason in words. */
export function checkNumbers(first: string, second: string): { number: string | null; problem: string } {
  const a = normalizeBdNumber(first);
  if (!first.trim()) return { number: null, problem: "Type or paste the number to send to." };
  if (!a) return { number: null, problem: "That is not a Bangladesh mobile number (11 digits starting 01)." };
  if (!second.trim()) return { number: null, problem: "Type the number a second time to check it." };
  const b = normalizeBdNumber(second);
  if (b !== a) return { number: null, problem: "The two numbers are not the same. Check both." };
  return { number: a, problem: "" };
}

/** Holds that are only an order question still count as real money (migration 061); a fake-SMS suspicion does not. */
const ORDER_ONLY_HOLDS = ["amount_mismatch", "paid_before_order", "wrong_phone", "phone_mismatch", "order_expired_before_payment"];

export interface PayablePayment {
  id: string;
  txn_type: string;
  status: string;
  chain_status: string | null;
  review_reason: string | null;
}

/** Why a transaction cannot be paid out, in words, or null when it can (the database's payout_refusal, mirrored). */
export function payoutRefusal(p: PayablePayment, taken: Set<string>): string | null {
  if (p.review_reason === "not_ours") return "Not one of this phone's wallets";
  if (!["cash_out", "send_money_received", "payment_received"].includes(p.txn_type)) return "Not money received";
  const counted = ["unmatched", "matched", "tracked_only"].includes(p.status) ||
    (p.status === "review" && p.chain_status === "ok" && ORDER_ONLY_HOLDS.some((h) => (p.review_reason ?? "").startsWith(h)));
  if (!counted) return "Held for review";
  if (taken.has(p.id)) return "Already paid out";
  return null;
}

/** The payout a transaction belongs to now (the live one), from the item rows. */
export function liveItemsByPayment(items: PayoutItemRow[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const i of items) if (i.live) m.set(i.payment_id, i.payout_id);
  return m;
}

export const PAYOUT_WORDS: Record<PayoutStatus, { label: string; tone: "ok" | "warn" | "bad" | "idle" }> = {
  sending: { label: "Sending…", tone: "idle" },
  paid: { label: "Paid", tone: "ok" },
  unsure: { label: "Check the wallet", tone: "warn" },
  failed: { label: "Failed, not sent", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "idle" },
};

export const METHOD_WORDS: Record<PayoutMethod, string> = { cash_in: "Cash In", send_money: "Send Money", manual: "paid by hand" };

const WALLET: Record<string, string> = { bkash: "bKash", nagad: "Nagad", rocket: "Rocket", upay: "Upay" };
const taka = (n: number) => "Tk " + n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** One sentence for a paid transaction's details: what was sent, where, how, from which phone, and what was kept. */
export function payoutLine(p: PayoutRow, phoneName: (id: string | null) => string): string {
  const to = p.to_number ? ` to ${groupDigits(p.to_number)}` : "";
  const from = p.method === "manual" ? "" : ` from ${phoneName(p.device_id)}'s ${WALLET[p.provider ?? ""] ?? p.provider ?? ""}${p.from_account === "personal" ? " (personal)" : ""}`;
  const how = ` by ${METHOD_WORDS[p.method]}`;
  const trx = p.trx_id ? ` · TrxID ${p.trx_id}` : "";
  const kept = ` · kept ${taka(num(p.keep_amount))} (${num(p.keep_pct)}%) of ${taka(num(p.total_amount))}`;
  return `${taka(num(p.send_amount))}${to}${how}${from}${trx}${kept}`;
}

/** What an unsure payout needs from the owner. */
export const UNSURE_HELP =
  "The phone stopped after typing the PIN, so PayTrace cannot tell whether the money went. Check the wallet (its statement on the phone card, or the SMS), then say which. The transactions stay taken until you do, so they can never be paid twice.";

export interface WalletAccount { provider: string; number: string; slot: number; found: boolean; kind?: "agent" | "personal" }

export interface SenderOption {
  key: string;
  deviceId: string;
  provider: string;
  account: "agent" | "personal";
  label: string;
  /** Empty when this sender can send now; otherwise why not, in words. */
  why: string;
}

/** The wallets a payout can be sent from: every bKash and Nagad account saved in the app of an approved phone. An agent
 *  sends by Cash In (needs the phone's send-money switch); a personal bKash account sends by Send Money (also needs the
 *  phone's personal-accounts switch). Personal Nagad waits for a recording of its Send Money menu. */
export function senderOptions(
  phones: Array<{ id: string; name: string; status: string; allow_cashin?: boolean; allow_personal?: boolean; info: { wallets?: WalletAccount[] } | null }>,
): SenderOption[] {
  const out: SenderOption[] = [];
  for (const d of phones) {
    if (d.status !== "approved") continue;
    for (const w of d.info?.wallets ?? []) {
      if (w.provider !== "bkash" && w.provider !== "nagad") continue;
      const account = w.kind === "personal" ? "personal" : "agent";
      const why = !d.allow_cashin
        ? "Sending money is switched off for this phone (Phones page, \"What the dashboard may do\")."
        : account === "personal" && w.provider !== "bkash"
          ? "Sending from a personal Nagad account is not built yet: it needs your recording of Nagad's Send Money menu."
          : account === "personal" && !d.allow_personal
            ? "Personal accounts are switched off for this phone (Phones page)."
            : "";
      out.push({
        key: `${d.id}:${w.provider}:${account}`,
        deviceId: d.id,
        provider: w.provider,
        account,
        label: `${d.name || "Unnamed phone"} · ${WALLET[w.provider]} ${account === "personal" ? "personal" : "agent"} · ${w.number}`,
        why,
      });
    }
  }
  return out.sort((a, b) => (a.why ? 1 : 0) - (b.why ? 1 : 0) || a.label.localeCompare(b.label));
}

/** How a sender moves the money: an agent wallet by Cash In, a personal account by Send Money. */
export const sendMethod = (account: "agent" | "personal"): PayoutMethod => (account === "personal" ? "send_money" : "cash_in");

/** Why a send of this size cannot go, or "" (the wallet's and PayTrace's limits per send). */
export function sendProblem(send: number, method: PayoutMethod): string {
  if (method === "manual") return "";
  if (send < 100) return `Tk ${send} is under the Tk 100 one send can carry. Tick more transactions together.`;
  if (send > 50000) return `Tk ${send.toLocaleString("en-IN")} is over the Tk 50,000 one send can carry. Tick fewer.`;
  return "";
}

/** The numbers paid before, newest first and each once, for one-tap reuse (nothing has to be saved beforehand). */
export function recentNumbers(payouts: PayoutRow[], limit = 6): string[] {
  const seen: string[] = [];
  for (const p of [...payouts].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))) {
    if (p.to_number && !seen.includes(p.to_number) && p.status !== "failed" && p.status !== "cancelled") seen.push(p.to_number);
    if (seen.length >= limit) break;
  }
  return seen;
}
