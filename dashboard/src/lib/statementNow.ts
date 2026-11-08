// "We just did a B2B / Cash In" (migration 070, owner 2026-11-08): the wallet's statement is read at once, so the entry is
// saved before it scrolls off the wallet's list. The answer of ask_statement_now in plain words. Pure, no imports.

export interface StatementNowAnswer { ok?: boolean; queued?: boolean; reason?: string }

export function statementNowText(a: StatementNowAnswer | null, wallet: string): { text: string; ok: boolean } {
  if (!a) return { text: "Could not ask the phone. Try again.", ok: false };
  if (a.ok && a.queued) return { text: `The phone is reading the ${wallet} statement now (a minute or two). The entry then shows in the day's figures.`, ok: true };
  switch (a.reason) {
    case "already_reading":
    case "just_asked":
      return { text: `The phone is already reading the ${wallet} statement; it will bring this entry back too.`, ok: true };
    case "balance_off":
      return { text: "\"May check balance\" is off for this phone, so it cannot read the statement. Switch it on above.", ok: false };
    case "not_approved":
      return { text: "This phone is not approved.", ok: false };
    case "no_flow":
      return { text: `PayTrace cannot read a ${wallet} statement yet.`, ok: false };
    default:
      return { text: "Could not ask the phone. Try again.", ok: false };
  }
}

/** Wallets whose statement can be read (Rocket has no statement flow yet). */
export const canReadStatement = (provider: string): boolean => provider === "bkash" || provider === "nagad";
