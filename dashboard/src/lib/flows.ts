// Money that moved through a phone's wallets on one Bangladesh day, in the three directions the owner wants side by
// side (2026-11-03): Cash Out (came in from a customer), Cash In (the agent sent out to a personal number) and B2B (the
// agent sent to its distributor). Rows come from the database view `device_day_flows`; this file only adds them up.

export type FlowKind = "cash_out" | "cash_out_stmt" | "cash_in" | "b2b_out";
export const FLOW_KINDS: FlowKind[] = ["cash_out", "cash_out_stmt", "cash_in", "b2b_out"];

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
  cash_out: {
    label: "Cash Out (SMS)",
    meaning:
      "Money that came IN to the agent wallet: customers' Cash Out receipts, from the SMS. Counts every receipt whose money really arrived, " +
      "including one held only because the amount or order did not match. A receipt held for a balance-chain doubt is counted once the wallet's " +
      "statement or live balance confirms it.",
  },
  cash_out_stmt: {
    label: "Cash Out (statement)",
    meaning:
      "The same thing in the wallet's own words: Cash Out entries the phone read from the bKash / Nagad statement for that day. The statement " +
      "shows only its newest entries at each pull, so on a busy day it can list fewer than the SMS did; Rocket has no statement menu.",
  },
  cash_in: {
    label: "Cash In",
    meaning:
      "Money the agent SENT OUT to a customer's wallet. bKash sends an SMS for an agent cash-in and those are counted. Nagad and Rocket " +
      "send no SMS for one, so for them only the cash-ins PayTrace knows about are here: cash-ins told from this dashboard that finished, " +
      "and partner-reported cash-ins that were verified or accepted.",
  },
  b2b_out: {
    label: "B2B",
    meaning: "Money the agent sent to its distributor. Rocket's and bKash's B2B-out receipts are recognised; a Nagad B2B-out message has never been seen (Nagad's B2B Received, money coming in, is read and kept apart).",
  },
};

export const emptyFlows = (): Flows => ({
  cash_out: { n: 0, amount: 0 },
  cash_out_stmt: { n: 0, amount: 0 },
  cash_in: { n: 0, amount: 0 },
  b2b_out: { n: 0, amount: 0 },
});

/** How the SMS and the statement compare for one wallet and day, in words for the card. */
export function agreement(f: Flows): { tone: "ok" | "warn" | "none"; text: string } {
  if (!f.cash_out_stmt.n && !f.cash_out.n) return { tone: "none", text: "" };
  if (!f.cash_out_stmt.n) return { tone: "none", text: "no statement for this day yet" };
  const diff = Math.round((f.cash_out.amount - f.cash_out_stmt.amount) * 100) / 100;
  if (Math.abs(diff) < 0.005 && f.cash_out.n === f.cash_out_stmt.n) return { tone: "ok", text: "SMS and statement agree" };
  if (diff > 0) return { tone: "warn", text: `SMS has Tk ${diff.toLocaleString("en-IN")} more than the statement showed` };
  return { tone: "warn", text: `statement has Tk ${(-diff).toLocaleString("en-IN")} more than the SMS` };
}

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
