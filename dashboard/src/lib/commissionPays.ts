// Daily commission payouts (migration 068, owner 2026-11-08): each partner's commission for one Bangladesh day becomes due
// after 11:59 PM and is paid by Cash In from the partner's own agent wallet (no charge), by Send Money from one of the
// owner's personal bKash accounts (the bKash fee comes off the commission), or marked paid by hand. Pure words and
// arithmetic; the database repeats every rule (create_commission_pay / manual_commission_pay). No I/O, no imports.

export type DayState = "running" | "due" | "part" | "paid_before" | "sending" | "paid" | "unsure";

export interface CommissionDayRow {
  device_id: string;
  day: string;
  commission: number | string;
  pay_id: string | null;
  pay_status: string | null;
  lump: number | string;
  due: number | string;
  state: DayState;
}

export type PayMethod = "cash_in" | "send_money" | "manual";
export type PayStatus = "sending" | "paid" | "unsure" | "failed" | "cancelled";

export interface CommissionPayRow {
  id: string;
  device_id: string;
  method: PayMethod;
  status: PayStatus;
  from_device_id: string | null;
  provider: string | null;
  to_number: string | null;
  days_amount: number | string;
  carry_in: number | string;
  fee_reserved: number | string;
  send_amount: number | string;
  carry_out: number | string;
  fee_actual: number | string | null;
  trx_id: string | null;
  error: string | null;
  note: string | null;
  created_at: string;
  paid_at: string | null;
}

export interface PayDayRow { pay_id: string; device_id: string; day: string; amount: number | string; live: boolean }

const num = (v: number | string | null | undefined) => (v == null ? 0 : Number(v) || 0);
const round2 = (n: number) => Math.round(n * 100) / 100;
const taka = (n: number) => "Tk " + n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** Days a person can tick: finished and still owing something, with no payment of their own. */
export const payable = (r: CommissionDayRow): boolean => (r.state === "due" || r.state === "part") && num(r.due) > 0;

export const DAY_WORDS: Record<DayState, { label: string; tone: "ok" | "warn" | "bad" | "idle" | "info" }> = {
  running: { label: "Running (payable after 11:59 PM)", tone: "idle" },
  due: { label: "Due", tone: "warn" },
  part: { label: "Partly paid earlier", tone: "warn" },
  paid_before: { label: "Paid (earlier payment)", tone: "ok" },
  sending: { label: "Sending…", tone: "info" },
  paid: { label: "Paid", tone: "ok" },
  unsure: { label: "Check the wallet", tone: "bad" },
};

export const METHOD_WORDS: Record<PayMethod, string> = { cash_in: "Cash In", send_money: "Send Money", manual: "paid by hand" };

/** What leaves the wallet for a payment: whole taka, the bKash fee (Send Money only) taken off the commission, and the
 *  paisa left over carried to the partner's next payment. The same sums as the database's create_commission_pay. */
export function splitCommission(due: number, carry: number, fee: number): { total: number; send: number; carryOut: number } {
  const total = round2(due + carry);
  const send = Math.max(0, Math.floor(round2(total - fee) + 1e-9));
  return { total, send, carryOut: round2(total - fee - send) };
}

/** Why a payment of this size cannot go through a phone, or "" (one send is Tk 100 to Tk 50,000). */
export function sizeProblem(send: number): string {
  if (send < 100) return `Tk ${send} is under the Tk 100 one send can carry. Tick more days together, or mark them paid by hand.`;
  if (send > 50000) return `Tk ${send.toLocaleString("en-IN")} is over the Tk 50,000 one send can carry. Tick fewer days.`;
  return "";
}

/** Paisa still owed to a partner from earlier whole-taka payments (live payments only). */
export function carryOf(pays: CommissionPayRow[], deviceId: string): number {
  return round2(pays.filter((p) => p.device_id === deviceId && ["sending", "paid", "unsure"].includes(p.status))
    .reduce((s, p) => s + num(p.carry_out) - num(p.carry_in), 0));
}

/** Partners with something to pay, most owed first: [device, due total, due days]. */
export function partnersOwed(rows: CommissionDayRow[]): Array<{ deviceId: string; due: number; days: number }> {
  const m = new Map<string, { due: number; days: number }>();
  for (const r of rows) {
    if (!payable(r)) continue;
    const e = m.get(r.device_id) ?? { due: 0, days: 0 };
    e.due = round2(e.due + num(r.due));
    e.days += 1;
    m.set(r.device_id, e);
  }
  return [...m.entries()].map(([deviceId, e]) => ({ deviceId, ...e })).sort((a, b) => b.due - a.due);
}

/** One sentence for a paid day or a payment: how much, how, from where, to whom, and the fee. */
export function payLine(p: CommissionPayRow, phoneName: (id: string | null) => string): string {
  const sent = taka(num(p.send_amount));
  const how = METHOD_WORDS[p.method];
  const from = p.method === "manual" ? "" : ` from ${phoneName(p.from_device_id)}'s ${p.provider === "nagad" ? "Nagad" : "bKash"}${p.method === "send_money" ? " (personal)" : ""}`;
  const to = p.to_number ? ` to ${p.to_number}` : "";
  const trx = p.trx_id ? ` · TrxID ${p.trx_id}` : "";
  const fee = p.method === "send_money"
    ? ` · bKash fee ${p.fee_actual == null ? taka(num(p.fee_reserved)) + " taken off" : taka(num(p.fee_actual))}`
    : "";
  const carry = num(p.carry_out) > 0 ? ` · ${taka(num(p.carry_out))} carried to the next payment` : "";
  return `${sent} by ${how}${from}${to}${trx}${fee}${carry}`;
}

export const UNSURE_HELP =
  "The phone stopped after typing the PIN, so PayTrace cannot tell whether the money went. Check the wallet (its SMS or statement), then say which. The days stay taken until you do, so they can never be paid twice.";

/** Sending options for a partner: Cash In from their own agent wallets, Send Money from any personal bKash. */
export interface SendOption { key: string; method: "cash_in" | "send_money"; fromDevice: string; provider: string; label: string; why: string }

export function sendOptions(
  partnerId: string,
  phones: Array<{ id: string; name: string; status: string; allow_cashin?: boolean; allow_personal?: boolean; info: { wallets?: Array<{ provider: string; number: string; kind?: string }> } | null }>,
): SendOption[] {
  const out: SendOption[] = [];
  const partner = phones.find((p) => p.id === partnerId);
  for (const w of partner?.info?.wallets ?? []) {
    if (w.kind === "personal" || (w.provider !== "bkash" && w.provider !== "nagad")) continue;
    out.push({
      key: `cash_in:${partnerId}:${w.provider}`, method: "cash_in", fromDevice: partnerId, provider: w.provider,
      label: `Cash In from ${partner!.name}'s own ${w.provider === "nagad" ? "Nagad" : "bKash"} agent wallet (no charge)`,
      why: partner!.status !== "approved" ? "That phone is not approved." : partner!.allow_cashin ? "" : "Sending money is switched off for that phone (Phones page).",
    });
  }
  for (const d of phones) {
    if (d.status !== "approved") continue;
    for (const w of d.info?.wallets ?? []) {
      if (w.kind !== "personal" || w.provider !== "bkash") continue;
      out.push({
        key: `send_money:${d.id}`, method: "send_money", fromDevice: d.id, provider: "bkash",
        label: `Send Money from ${d.name}'s personal bKash · ${w.number} (fee taken off the commission)`,
        why: !d.allow_cashin ? "Sending money is switched off for that phone." : !d.allow_personal ? "Personal accounts are switched off for that phone." : "",
      });
    }
  }
  return out;
}
