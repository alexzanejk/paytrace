// Agent jobs: pure helpers (no imports, so they run in the unit tests on their own).
// The owner writes ONE job (what to do + a wallet address per provider). A phone whose newest printed balance for a provider reaches
// the threshold sees it in its app. PayTrace only shows the instruction; the agent does the work outside it and taps Done.

export const JOB_PROVIDERS = ["bkash", "nagad", "rocket", "upay"] as const;
export type JobProvider = (typeof JOB_PROVIDERS)[number];

const NAMES: Record<string, string> = { bkash: "bKash", nagad: "Nagad", rocket: "Rocket", upay: "Upay" };

export const URGENCIES = ["normal", "urgent", "critical"] as const;
export type Urgency = (typeof URGENCIES)[number];
export const URGENCY_LABEL: Record<Urgency, string> = { normal: "Normal", urgent: "Urgent", critical: "Critical" };

export const DEFAULT_THRESHOLD = 10000;
export const MAX_INSTRUCTION = 1000;

export interface JobSettings {
  enabled: boolean;
  threshold: number;
  instruction: string;
  wallets: Partial<Record<JobProvider, string>>;
  urgency: Urgency;
  network: string;
}

export const DEFAULT_NETWORK = "BNB Smart Chain (BEP20)";

/** The same rule the database applies: 6 to 60 letters, numbers or . _ - + : @ / characters, and an address that starts with 0x must be a
 *  real BNB Smart Chain (EVM) address: 0x followed by exactly 40 letters or numbers (0 to 9, a to f). */
export const validWallet = (s: string): boolean => {
  const t = s.trim();
  if (t.startsWith("0x")) return /^0x[0-9a-fA-F]{40}$/.test(t);
  return /^[0-9A-Za-z+ ._:@/-]{6,60}$/.test(t);
};

/** What is wrong with a wallet address, in plain words. Null when it is fine. */
export function addressProblem(s: string): string | null {
  const t = s.trim();
  if (t === "") return null;
  if (t.startsWith("0x")) return /^0x[0-9a-fA-F]{40}$/.test(t) ? null : "A BNB Smart Chain address starts with 0x and is 42 characters long. Copy it again from Trust Wallet.";
  return validWallet(t) ? null : "A wallet address is 6 to 60 letters or numbers.";
}

/** The network name shown next to the address. */
export function networkProblem(s: string): string | null {
  const t = s.trim();
  return t.length >= 2 && t.length <= 60 ? null : "Type the network, for example BNB Smart Chain (BEP20).";
}

/** One address for every wallet type (it is the owner's own wallet). Empty means none. */
export function walletsFromAddress(address: string): Partial<Record<JobProvider, string>> {
  const a = address.trim();
  const out: Partial<Record<JobProvider, string>> = {};
  if (a === "") return out;
  for (const p of JOB_PROVIDERS) out[p] = a;
  return out;
}

/** The first address in a saved set, to show in the single address box. */
export function addressOf(wallets: Partial<Record<JobProvider, string>>): string {
  for (const p of JOB_PROVIDERS) if ((wallets[p] ?? "").trim() !== "") return (wallets[p] ?? "").trim();
  return "";
}

/** Reads the amount box. Null when it is not a number between 100 and 100,000,000. */
export function parseThreshold(text: string): number | null {
  const t = text.replace(/,/g, "").trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n >= 100 && n <= 100_000_000 ? n : null;
}

/** "Tk 12,000.00" */
export const takaText = (n: number): string => "Tk " + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Fills {agent}, {provider} and {balance} in the owner's text, exactly as the database does for the phone. */
export function fillTemplate(text: string, provider: string, balance: number, agent = "Agent"): string {
  return text.split("{agent}").join(agent).split("{provider}").join(NAMES[provider] ?? provider).split("{balance}").join(takaText(balance));
}

export interface JobProblem {
  field: "threshold" | "instruction" | "wallets" | "wallet";
  provider?: JobProvider;
  message: string;
}

/** What is wrong with the form, in plain words. An empty list means it can be saved. */
export function checkJobForm(f: { enabled: boolean; threshold: string; instruction: string; wallets: Partial<Record<JobProvider, string>> }): JobProblem[] {
  const out: JobProblem[] = [];
  if (parseThreshold(f.threshold) === null) out.push({ field: "threshold", message: "Type an amount of 100 Tk or more, such as 10000." });
  const text = f.instruction.trim();
  if (text.length > MAX_INSTRUCTION) out.push({ field: "instruction", message: `Keep the instruction under ${MAX_INSTRUCTION} characters.` });
  if (f.enabled && text === "") out.push({ field: "instruction", message: "Write what the agent should do." });
  let any = false;
  for (const p of JOB_PROVIDERS) {
    const w = (f.wallets[p] ?? "").trim();
    if (w === "") continue;
    any = true;
    if (!validWallet(w)) out.push({ field: "wallet", provider: p, message: `${NAMES[p]}: a wallet address is 6 to 60 letters or numbers.` });
  }
  if (f.enabled && !any) out.push({ field: "wallets", message: "Add at least one wallet address." });
  return out;
}

/** The wallets to send: only the filled ones, trimmed. */
export function cleanWallets(wallets: Partial<Record<JobProvider, string>>): Partial<Record<JobProvider, string>> {
  const out: Partial<Record<JobProvider, string>> = {};
  for (const p of JOB_PROVIDERS) {
    const w = (wallets[p] ?? "").trim();
    if (w !== "") out[p] = w;
  }
  return out;
}

/** One agent = one wallet (bKash, Nagad, Rocket or Upay) on one phone. Anything left empty uses the default job. */
export interface AgentForm {
  name: string;
  instruction: string;
  urgency: "" | Urgency;
  wallet: string;
  network: string;
}

export function checkAgentForm(f: AgentForm): string | null {
  if (f.name.trim().length > 40) return "Keep the agent's name under 40 characters.";
  if (f.instruction.trim().length > MAX_INSTRUCTION) return `Keep the description under ${MAX_INSTRUCTION} characters.`;
  const w = addressProblem(f.wallet);
  if (w) return w;
  if (f.network.trim() !== "" && networkProblem(f.network)) return networkProblem(f.network);
  return null;
}

/** Plain words for where this agent stands. */
export function agentStatus(a: { jobsOn: boolean; agentOn: boolean; balance: number | null; threshold: number; hasWallet: boolean; showing: boolean }): string {
  if (!a.jobsOn) return "Jobs are off";
  if (!a.agentOn) return "Switched off";
  if (a.showing) return "Job showing now";
  if (a.balance === null) return "No balance yet";
  if (a.balance < a.threshold) return "Below the amount";
  if (!a.hasWallet) return "Needs a wallet address";
  return "Marked done, waiting for a newer balance";
}
