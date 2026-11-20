// Telegram step 4 (owner 2026-11-20): one payout per person, all of their matched transactions in one send, to a number
// typed for that person, fed to the phones over time. The server keeps a PLAN per person (`payout_plans`): it becomes an
// ordinary payout the moment that phone is free. Pure helpers; the reads and the RPC live in the components.
// Tested in tests/payoutPlans.test.ts.

export type PlanStatus = "queued" | "sending" | "paid" | "unsure" | "failed" | "cancelled";

export interface PayoutPlan {
  id: string;
  label: string;
  tg_user_id: number | null;
  payment_ids: string[];
  count: number;
  total: number | string;
  device_id: string;
  provider: string;
  from_account: "agent" | "personal";
  account: number | null;
  via: "ussd" | "app";
  to_number: string;
  keep_pct: number | string;
  note: string | null;
  status: PlanStatus;
  payout_id: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export const PLAN_WORDS: Record<PlanStatus, { label: string; tone: "ok" | "warn" | "bad" | "idle"; meaning: string }> = {
  queued: { label: "Waiting for the phone", tone: "idle", meaning: "Another send is running on that phone; this one starts when it is free." },
  sending: { label: "Sending…", tone: "idle", meaning: "The phone is sending it now." },
  paid: { label: "Paid", tone: "ok", meaning: "The wallet confirmed it." },
  unsure: { label: "Check the wallet", tone: "warn", meaning: "The phone stopped after the PIN. Decide on the Payout page: it was sent, or it was not." },
  failed: { label: "Failed, not sent", tone: "bad", meaning: "Nothing was sent; the transactions are free to pay again." },
  cancelled: { label: "Cancelled", tone: "idle", meaning: "Taken back before it started." },
};

/** Plans worth showing on the queue card: everything live, and what ended in the last `hours`. */
export function recentPlans(plans: PayoutPlan[], now = new Date(), hours = 24): PayoutPlan[] {
  const since = now.getTime() - hours * 3600_000;
  return plans
    .filter((p) => p.status === "queued" || p.status === "sending" || p.status === "unsure" || new Date(p.finished_at ?? p.created_at).getTime() >= since)
    .sort((a, b) => order(a) - order(b) || b.created_at.localeCompare(a.created_at));
}
const order = (p: PayoutPlan) => (p.status === "unsure" ? 0 : p.status === "sending" ? 1 : p.status === "queued" ? 2 : 3);

/** One line per plan: "t9ceff6182 · 3 transactions, Tk 1,500 · to 01722 222222 · from Vivo". */
export function planLine(p: PayoutPlan, phoneName: (id: string) => string): string {
  const n = `${p.count} transaction${p.count === 1 ? "" : "s"}`;
  return `${p.label} · ${n}, Tk ${Number(p.total).toLocaleString("en-US", { minimumFractionDigits: 2 })} · to ${p.to_number} · from ${phoneName(p.device_id)}${p.via === "app" ? " (app)" : ""}`;
}

/** Where each queued plan stands on its phone: 1 = next, 2 = after one more, ... */
export function queuePositions(plans: PayoutPlan[]): Map<string, number> {
  const out = new Map<string, number>();
  const byPhone = new Map<string, PayoutPlan[]>();
  for (const p of plans) if (p.status === "queued") byPhone.set(p.device_id, [...(byPhone.get(p.device_id) ?? []), p]);
  for (const list of byPhone.values()) {
    list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    list.forEach((p, i) => out.set(p.id, i + 1));
  }
  return out;
}

/** The transactions a live plan already holds, by transaction id, with the plan's label (so the Payout page can say
 *  "queued for t9ceff6182" and not offer the tick). */
export function plannedByPayment(plans: PayoutPlan[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of plans) if (p.status === "queued") for (const id of p.payment_ids) out.set(id, p.label);
  return out;
}

/** The sender to offer first for a person's transactions: the wallet that received most of them, as an agent wallet,
 *  else the first wallet that can send. */
export function preferredSender<T extends { key: string; deviceId: string; provider: string; account: string; why: string }>(
  options: T[], payments: Array<{ device_id?: string | null; provider: string }>,
): T | undefined {
  const tally = new Map<string, number>();
  for (const p of payments) {
    const k = `${p.device_id ?? "*"}:${p.provider}`;
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k.split(":") as [string, string]);
  for (const [dev, prov] of ranked) {
    // The phone is not always known (a Telegram claim names the phone, not its id): then the wallet type decides.
    const hit = options.find((o) => !o.why && o.account === "agent" && o.provider === prov && (dev === "*" || o.deviceId === dev));
    if (hit) return hit;
  }
  return options.find((o) => !o.why);
}
