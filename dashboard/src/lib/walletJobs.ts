// One job per wallet (migration 072, owner 2026-11-08): every phone's bKash / Nagad / Rocket / Upay has ONE job, chosen on
// the Jobs page and changeable any time: Taka (Cash In to one of the owner's personal numbers) or Crypto (send to the
// owner's crypto wallet), from that wallet's own amount. A wallet type has a default (bKash Taka at 8,000, Nagad crypto at
// 10,000, Rocket crypto at 5,000); a phone's wallet may use it or have its own. Pure words and checks, no imports.

export type JobKind = "cashin" | "crypto" | "off";

export interface WalletJobRow {
  device_id: string;
  provider: string;
  balance: number | string | null;
  balance_at: string | null;
  own_money: number | string | null;
  kind: JobKind;
  kind_own: boolean;
  threshold: number | string;
  threshold_own: boolean;
  /** What the phone shows right now: a crypto job, a Taka job, or nothing. */
  showing: "crypto" | "cashin" | null;
  /** The owner's enabled personal numbers of this wallet type (a Taka job needs one). */
  numbers: number;
}

export interface WalletJobRule { provider: string; kind: JobKind; threshold: number | string }

export const JOB_KINDS: JobKind[] = ["cashin", "crypto", "off"];

export const KIND_LABEL: Record<JobKind, string> = {
  cashin: "Taka (to our number)",
  crypto: "Crypto (to our wallet)",
  off: "No job",
};
export const KIND_SHORT: Record<JobKind, string> = { cashin: "Taka", crypto: "Crypto", off: "No job" };

const WALLET: Record<string, string> = { bkash: "bKash", nagad: "Nagad", rocket: "Rocket", upay: "Upay" };
const num = (v: number | string | null | undefined): number | null => (v == null || v === "" ? null : Number(v));
const taka = (n: number) => "Tk " + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

/** An amount typed by the owner: whole taka, at least 100 (commas and "Tk" allowed). Null when it is not one; "" = use the default. */
export function parseJobAmount(text: string): number | null | "" {
  const t = text.replace(/[\s,]/g, "").replace(/^tk/i, "");
  if (t === "") return "";
  if (!/^\d{3,9}(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n >= 100 && n <= 100_000_000 ? n : null;
}

export type Tone = "ok" | "warn" | "bad" | "idle";

/** Where a wallet stands, in one line: its job on the phone now, how much is still to go, or what stops it. */
export function standing(r: WalletJobRow, jobsOn: boolean): { text: string; tone: Tone } {
  const own = num(r.own_money);
  const amount = Number(r.threshold);
  const wallet = WALLET[r.provider] ?? r.provider;
  if (!jobsOn) return { text: "Jobs are switched off for every phone.", tone: "idle" };
  if (r.kind === "off") return { text: "No job for this wallet.", tone: "idle" };
  if (r.showing) return { text: `${KIND_SHORT[r.showing]} job is on the phone now.`, tone: "warn" };
  // A Taka job sends to our number of the same type if one is saved, else to any saved bKash / Nagad number (migration 073).
  if (r.kind === "cashin" && r.numbers === 0) return { text: `No number of ours saved to send to (${wallet}, bKash or Nagad). Add one under "Taka job" below.`, tone: "bad" };
  if (own === null) return { text: "No balance seen yet.", tone: "idle" };
  if (own < amount) return { text: `${taka(amount - own)} to go before the job starts.`, tone: "ok" };
  return { text: "At the amount: the job reaches the phone within a minute.", tone: "warn" };
}

/** "Default (Taka at Tk 8,000)" for the job chooser. */
export const defaultLabel = (rule: WalletJobRule | undefined): string =>
  rule ? `Default (${KIND_SHORT[rule.kind]}${rule.kind === "off" ? "" : ` at ${taka(Number(rule.threshold))}`})` : "Default";

/** What to send for one wallet: null kind / amount = use the wallet type's default. */
export function wantFor(kindChoice: JobKind | "default", amountText: string): { kind: JobKind | null; threshold: number | null; problem: string } {
  const a = parseJobAmount(amountText);
  if (a === null) return { kind: null, threshold: null, problem: "Type the amount in taka, at least 100 (or leave it empty for the default)." };
  return { kind: kindChoice === "default" ? null : kindChoice, threshold: a === "" ? null : a, problem: "" };
}
