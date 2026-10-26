// ---- cash-in jobs (migration 035): the partner cashes in to one of the owner's personal numbers and types the amount and the
// commission the agent wallet itself gave for that cash-in (it is added to the balance; no SMS is sent for a cash-in). ----

export const CASHIN_PROVIDERS = ["bkash", "nagad", "rocket", "upay"] as const;
export type CashinProvider = (typeof CASHIN_PROVIDERS)[number];

export type CashinStatus = "open" | "checking" | "mismatch" | "review" | "verified" | "rejected" | "cancelled";

export const CASHIN_LABEL: Record<CashinStatus, string> = {
  open: "Waiting for the partner",
  checking: "Waiting for the cash-out message",
  mismatch: "Doesn't add up (partner may fix once)",
  review: "Doesn't add up: needs you",
  verified: "Verified",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export const CASHIN_TONE: Record<CashinStatus, "warn" | "bad" | "ok" | "idle"> = {
  open: "warn",
  checking: "warn",
  mismatch: "bad",
  review: "bad",
  verified: "ok",
  rejected: "idle",
  cancelled: "idle",
};

/** The owner can settle a submitted cash-in by hand until it is verified or rejected. */
export const cashinSettleable = (s: CashinStatus): boolean => s === "checking" || s === "mismatch" || s === "review";
/** A job the partner has not started can be cancelled by the owner. */
export const cashinCancellable = (s: CashinStatus): boolean => s === "open";

/** A Bangladesh mobile number as the database keeps it: 11 digits starting with 01. +880 / 880 is accepted. Null when it is not one. */
export function normalizeNumber(text: string): string | null {
  const bn = text.replace(/[০-৯]/g, (c) => String(c.charCodeAt(0) - 0x09e6));
  let d = bn.replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("880")) d = "0" + d.slice(3);
  return /^01[0-9]{9}$/.test(d) ? d : null;
}

/** What the wallet balance must have been just before the next cash-out: the old balance, minus the cash-in, plus the cash-in commission. */
export function expectedBefore(base: number, amount: number, commission: number): number {
  return Math.round((base - amount + commission) * 100) / 100;
}

export function numberProblem(text: string): string | null {
  return normalizeNumber(text) ? null : "A mobile number has 11 digits and starts with 01, for example 01712345678.";
}

