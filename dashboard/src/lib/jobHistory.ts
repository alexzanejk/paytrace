// Job history (owner 2026-11-08: "where do we see completed and pending jobs? ... build the job history with tabs").
// One list of every job, both kinds, in four tabs by how far it has got:
//   Pending   the job is on the partner's phone and they have not said they did it yet
//   Waiting   the partner submitted it; PayTrace (or you) has not settled it yet
//   Done      verified, by the wallet's message or by your Accept
//   Closed    rejected by you, cancelled by you, or taken off the phone because the wallet's job was switched / jobs went off
// Pending and Waiting always show everything open, however old; Done and Closed follow the chosen dates (by when they were
// settled). Pure: the page loads the rows, this file sorts, filters and adds them up. No imports.

export type JobKindH = "taka" | "crypto";
export type Stage = "pending" | "waiting" | "done" | "closed";

export const STAGES: Stage[] = ["pending", "waiting", "done", "closed"];
export const STAGE_LABEL: Record<Stage, string> = {
  pending: "Pending",
  waiting: "Waiting for OK",
  done: "Done",
  closed: "Rejected / cancelled",
};
export const STAGE_HELP: Record<Stage, string> = {
  pending: "On the partner's phone now. They have not said they did it yet.",
  waiting: "The partner says it is done. PayTrace confirms it when the wallet's message adds up, or you Accept / Reject it.",
  done: "Verified: the wallet's message added up, or you accepted it.",
  closed: "Rejected by you, cancelled by you, or taken off the phone because the wallet's job was changed or jobs were switched off.",
};

export interface HistoryItem {
  id: string;
  kind: JobKindH;
  device_id: string;
  provider: string;
  stage: Stage;
  /** The table's own status (open, checking, mismatch, review, verified, rejected, cancelled, shown). */
  status: string;
  /** When it appeared on the phone (the balance reading that started it). */
  shown_at: string | null;
  submitted_at: string | null;
  settled_at: string | null;
  /** The wallet balance the job was shown at. */
  balance: number | null;
  amount: number | null;
  /** Commission (Taka job) or charge (crypto job). */
  charge: number | null;
  cost: number;
  cost_note: string | null;
  /** Our number (Taka job). */
  number: string | null;
  note: string | null;
  diff: number | null;
  /** Taka job: cancelled by the system because the wallet's job was switched (note 'switched'), not by a person. */
  switched: boolean;
}

const n = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const s = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

export function stageOf(status: string): Stage {
  if (status === "open" || status === "shown") return "pending";
  if (status === "checking" || status === "mismatch" || status === "review") return "waiting";
  if (status === "verified") return "done";
  return "closed";
}

/** A row of `cashin_jobs` (the Taka job). */
export function fromCashin(r: Record<string, unknown>): HistoryItem {
  const status = String(r.status ?? "");
  return {
    id: String(r.id), kind: "taka", device_id: String(r.device_id), provider: String(r.provider), stage: stageOf(status), status,
    shown_at: s(r.balance_at) ?? s(r.created_at), submitted_at: s(r.submitted_at),
    settled_at: ["verified", "rejected", "cancelled"].includes(status) ? s(r.checked_at) : null,
    balance: n(r.balance), amount: n(r.amount), charge: n(r.commission), cost: n(r.cost) ?? 0, cost_note: s(r.cost_note),
    number: s(r.number), note: s(r.note) === "switched" ? null : s(r.note), diff: n(r.diff),
    switched: status === "cancelled" && r.note === "switched",
  };
}

/** A row of `job_transfers` (the crypto job, once the partner submitted it). */
export function fromTransfer(r: Record<string, unknown>): HistoryItem {
  const status = String(r.status ?? "");
  return {
    id: String(r.id), kind: "crypto", device_id: String(r.device_id), provider: String(r.provider), stage: stageOf(status), status,
    shown_at: s(r.since) ?? s(r.base_at), submitted_at: s(r.submitted_at),
    settled_at: status === "verified" || status === "rejected" ? s(r.checked_at) : null,
    balance: n(r.shown_balance) ?? n(r.base_balance), amount: n(r.amount), charge: n(r.charge), cost: n(r.cost) ?? 0, cost_note: s(r.cost_note),
    number: null, note: s(r.note), diff: n(r.diff), switched: false,
  };
}

/** A crypto job on the phone right now (`admin_open_jobs()`), not yet submitted. */
export function fromOpenCrypto(r: Record<string, unknown>): HistoryItem {
  return {
    id: `open-${r.device_id}-${r.provider}`, kind: "crypto", device_id: String(r.device_id), provider: String(r.provider),
    stage: "pending", status: "shown", shown_at: s(r.balance_at), submitted_at: null, settled_at: null,
    balance: n(r.balance), amount: null, charge: null, cost: 0, cost_note: null, number: null, note: null, diff: null, switched: false,
  };
}

/** The time a row is sorted and dated by: when it was settled, else submitted, else shown. */
export const timeOf = (i: HistoryItem): string => i.settled_at ?? i.submitted_at ?? i.shown_at ?? "";

/** Bangladesh calendar day of an ISO time ("2026-11-08"). */
export const dhakaDayOf = (iso: string): string => (iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" }) : "");

export interface HistoryFilter {
  device: string | null;
  kind: JobKindH | null;
  /** Bangladesh days, inclusive. Used for Done and Closed only. */
  from: string;
  to: string;
}

/** The rows of one tab, newest first. */
export function rowsFor(items: HistoryItem[], stage: Stage, f: HistoryFilter): HistoryItem[] {
  const dated = stage === "done" || stage === "closed";
  return items
    .filter((i) => i.stage === stage)
    .filter((i) => !f.device || i.device_id === f.device)
    .filter((i) => !f.kind || i.kind === f.kind)
    .filter((i) => {
      if (!dated) return true;
      const d = dhakaDayOf(timeOf(i));
      return d >= f.from && d <= f.to;
    })
    .sort((a, b) => timeOf(b).localeCompare(timeOf(a)));
}

/** How many rows each tab has with these filters (for the tab labels). */
export function stageCounts(items: HistoryItem[], f: HistoryFilter): Record<Stage, number> {
  return Object.fromEntries(STAGES.map((st) => [st, rowsFor(items, st, f).length])) as Record<Stage, number>;
}

export interface PhoneTotal { device_id: string; jobs: number; sent: number; charge: number; cost: number }

/** What each phone's partner sent in the Done rows, with the commission / charge and their other costs. Biggest first. */
export function totalsByPhone(rows: HistoryItem[]): PhoneTotal[] {
  const m = new Map<string, PhoneTotal>();
  for (const r of rows) {
    const t = m.get(r.device_id) ?? { device_id: r.device_id, jobs: 0, sent: 0, charge: 0, cost: 0 };
    t.jobs += 1;
    t.sent += r.amount ?? 0;
    t.charge += r.charge ?? 0;
    t.cost += r.cost;
    m.set(r.device_id, t);
  }
  return [...m.values()].sort((a, b) => b.sent - a.sent);
}

/** One line on what happened to a row, in plain words. */
export function resultText(i: HistoryItem): string {
  switch (i.status) {
    case "shown":
    case "open": return "Not done yet";
    case "checking": return "Waiting for the wallet's message";
    case "mismatch": return "Does not add up (partner may fix)";
    case "review": return "Does not add up: needs you";
    case "verified": return "Verified";
    case "rejected": return "Rejected by you";
    case "cancelled": return i.switched ? "Taken off (job changed)" : "Cancelled by you";
    default: return i.status;
  }
}

/** The CSV of a tab: one line per job, the partner's note as plain text. */
export function csvRows(rows: HistoryItem[], nameOf: (id: string) => string): unknown[][] {
  return rows.map((i) => [
    timeOf(i), nameOf(i.device_id), i.provider, i.kind === "taka" ? "Taka" : "Crypto", resultText(i),
    i.balance ?? "", i.amount ?? "", i.charge ?? "", i.cost || "", i.cost_note ?? "", i.number ?? "", i.note ?? "",
  ]);
}
export const CSV_HEADER = ["time", "phone", "wallet", "job", "result", "balance_when_shown", "sent", "commission_or_charge", "other_cost", "other_cost_for", "our_number", "owner_note"];
