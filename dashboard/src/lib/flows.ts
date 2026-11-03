// Money that moved through a phone's wallets on one Bangladesh day, in the three directions the owner wants side by
// side (2026-11-03): Cash Out (came in from a customer), Cash In (the agent sent out to a personal number) and B2B (the
// agent sent to its distributor). Rows come from the database view `device_day_flows`; this file only adds them up.

export type FlowKind = "cash_out" | "cash_in" | "b2b_out";
export const FLOW_KINDS: FlowKind[] = ["cash_out", "cash_in", "b2b_out"];

export interface FlowRow {
  day: string;
  device_id: string | null;
  provider: string;
  kind: FlowKind | string;
  n: number | string;
  amount: number | string;
}

export interface FlowSum {
  n: number;
  amount: number;
}

export type Flows = Record<FlowKind, FlowSum>;

/** What each column is called and what it means, in the words of the person reading the card. */
export const FLOW_WORDS: Record<FlowKind, { label: string; meaning: string }> = {
  cash_out: { label: "Cash Out", meaning: "Money that came IN to the agent wallet: customers' Cash Out receipts (from the SMS)." },
  cash_in: {
    label: "Cash In",
    meaning:
      "Money the agent SENT OUT to a personal number. A cash-in sends no SMS, so only the ones PayTrace knows about are here: " +
      "cash-ins told from this dashboard that finished, and partner-reported cash-ins that were verified or accepted.",
  },
  b2b_out: {
    label: "B2B",
    meaning: "Money the agent sent to its distributor. Only Rocket's B2B receipt is recognised so far; bKash and Nagad B2B messages have never been seen.",
  },
};

export const emptyFlows = (): Flows => ({ cash_out: { n: 0, amount: 0 }, cash_in: { n: 0, amount: 0 }, b2b_out: { n: 0, amount: 0 } });

const isKind = (k: string): k is FlowKind => (FLOW_KINDS as string[]).includes(k);

/** Adds the rows up. Unknown kinds (a future view change) are ignored rather than mis-filed. */
export function sumFlows(rows: FlowRow[]): Flows {
  const out = emptyFlows();
  for (const r of rows) {
    if (!isKind(r.kind)) continue;
    out[r.kind].n += Number(r.n) || 0;
    out[r.kind].amount += Number(r.amount) || 0;
  }
  return out;
}

/** Totals by any key (a provider, a phone). */
export function groupFlows(rows: FlowRow[], key: (r: FlowRow) => string): Map<string, Flows> {
  const buckets = new Map<string, FlowRow[]>();
  for (const r of rows) {
    const k = key(r);
    const list = buckets.get(k);
    if (list) list.push(r);
    else buckets.set(k, [r]);
  }
  return new Map([...buckets].map(([k, list]) => [k, sumFlows(list)]));
}

/** True when there is anything at all to show for this group. */
export const hasFlows = (f: Flows | undefined): boolean => !!f && FLOW_KINDS.some((k) => f[k].n > 0);
