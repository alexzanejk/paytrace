// Agent jobs: pure helpers (no imports, so they run in the unit tests on their own).
// The owner writes ONE job (what to do + a wallet address per provider). A phone whose newest printed balance for a provider reaches
// the threshold sees it in its app. PayTrace only shows the instruction; the agent does the work outside it and taps Done.

export const JOB_PROVIDERS = ["bkash", "nagad", "rocket", "upay"] as const;
export type JobProvider = (typeof JOB_PROVIDERS)[number];

const NAMES: Record<string, string> = { bkash: "bKash", nagad: "Nagad", rocket: "Rocket", upay: "Upay" };

export const DEFAULT_THRESHOLD = 10000;
export const MAX_INSTRUCTION = 1000;

export interface JobSettings {
  enabled: boolean;
  threshold: number;
  instruction: string;
  wallets: Partial<Record<JobProvider, string>>;
}

/** The same rule the database applies: 6 to 60 letters, numbers or . _ - + : @ / characters. */
export const validWallet = (s: string): boolean => /^[0-9A-Za-z+ ._:@/-]{6,60}$/.test(s.trim());

/** Reads the amount box. Null when it is not a number between 100 and 100,000,000. */
export function parseThreshold(text: string): number | null {
  const t = text.replace(/,/g, "").trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n >= 100 && n <= 100_000_000 ? n : null;
}

/** "Tk 12,000.00" */
export const takaText = (n: number): string => "Tk " + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Fills {provider} and {balance} in the owner's text, exactly as the database does for the phone. */
export function fillTemplate(text: string, provider: string, balance: number): string {
  return text.split("{provider}").join(NAMES[provider] ?? provider).split("{balance}").join(takaText(balance));
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
