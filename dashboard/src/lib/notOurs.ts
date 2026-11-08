// "Not ours" (migration 064): messages a phone forwarded from a wallet that is not set up in the PayTrace app on that
// phone. They are kept for the record and counted nowhere. Pure words for the Phones page; no I/O here.

export interface NotOursRow {
  device_id: string;
  provider: string;
  sim_slot: number | null;
  n: number;
  last_at: string | null;
  amount: number | string | null;
}

const WALLET: Record<string, string> = { bkash: "bKash", nagad: "Nagad", rocket: "Rocket", upay: "Upay" };
const wallet = (p: string) => WALLET[p] ?? p;

/** One line per ignored wallet of this phone, e.g. "Nagad: 5 messages in 7 days, ignored (no Nagad wallet is set up in the app on this phone)". */
export function notOursLines(rows: NotOursRow[], deviceId: string, saved: { provider: string; slot?: number | null }[] | null | undefined): string[] {
  const mine = rows.filter((r) => r.device_id === deviceId && r.n > 0);
  const byWallet = new Map<string, { n: number; sims: Set<number> }>();
  for (const r of mine) {
    const e = byWallet.get(r.provider) ?? { n: 0, sims: new Set<number>() };
    e.n += r.n;
    if (r.sim_slot != null) e.sims.add(r.sim_slot);
    byWallet.set(r.provider, e);
  }
  return [...byWallet.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([p, e]) => {
    const hasKind = (saved ?? []).some((w) => w.provider === p);
    const why = hasKind
      ? `the app's ${wallet(p)} wallet is in ${simList((saved ?? []).filter((w) => w.provider === p))}, these arrived on ${simList([...e.sims].map((s) => ({ slot: s })))}`
      : `no ${wallet(p)} wallet is set up in the app on this phone`;
    return `${wallet(p)}: ${e.n} message${e.n === 1 ? "" : "s"} in 7 days ignored as not yours (${why}).`;
  });
}

const simList = (ws: { slot?: number | null }[]): string => {
  const slots = [...new Set(ws.map((w) => w.slot).filter((s): s is number => s === 0 || s === 1))].sort();
  return slots.length ? slots.map((s) => `SIM ${s + 1}`).join(" and ") : "an unknown SIM";
};

/** The rule in one sentence, for the card's footnote. */
export const NOT_OURS_RULE =
  "A wallet that is not set up in the PayTrace app on this phone is not yours: its messages are kept for the record but never counted, never set a balance and never start a job. A phone with no wallet set up in the app is left as before.";
