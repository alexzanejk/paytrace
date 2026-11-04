// The automatic check of a payment held for a balance-chain mismatch (migration 053): PayTrace asks the phone for the
// wallet's live balance, then for its statement, and releases the payment when the wallet vouches for it. This file only
// puts the database's rows into words for the Review page. Pure, tested in tests/walletCheck.test.ts.

export interface PaymentCheck {
  id: string;
  payment_id: string;
  step: "balance" | "statement";
  command_id: string | null;
  status: "queued" | "confirmed" | "not_confirmed" | "failed";
  detail: string | null;
  created_at: string;
  finished_at: string | null;
}

/** Why a check could not even start, in the owner's words. */
export const START_ERRORS: Record<string, string> = {
  busy: "The phone is busy with another command. Try again in a minute.",
  balance_checks_off: "Balance checks are switched off for this phone (Phones page, \"What the dashboard may do with this phone\").",
  phone_not_approved: "The phone that received this SMS is no longer approved.",
  no_phone: "PayTrace does not know which phone received this SMS, so it cannot ask.",
  no_flow: "The wallet's menu is not known to PayTrace yet (Rocket), so the phone cannot check it.",
  not_a_chain_hold: "This payment is not held for a balance mismatch, so the wallet check does not apply.",
  no_payment: "Payment not found.",
};

/** One line for the newest check of a held payment (null = nothing has been asked yet). */
export function walletCheckLine(check: PaymentCheck | null, startError?: string): string | null {
  if (startError) return START_ERRORS[startError] ?? `Could not start the check (${startError}).`;
  if (!check) return null;
  const step = check.step === "balance" ? "the wallet's live balance" : "the wallet's statement";
  switch (check.status) {
    case "queued":
      return `Asking the phone for ${step} now. A match releases and credits this payment by itself.`;
    case "confirmed":
      return `Confirmed by ${step}. ${check.detail ?? ""}`.trim();
    case "not_confirmed":
      return `Not confirmed by ${step}: ${check.detail ?? "no match"}`;
    case "failed":
      return check.detail ?? `The check of ${step} did not run.`;
  }
}
