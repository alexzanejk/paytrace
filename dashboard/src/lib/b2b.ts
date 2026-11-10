/** A B2B transfer the phone makes through the bKash app, to that wallet's DSO (owner 2026-11-10, migration 083).
 *  Pure helpers, tested in tests/b2b.test.ts. The command's kind on the server is "btob" (kind names are letters only). */
import type { PhoneCommand } from "./phoneCommands";

export const B2B_KIND = "btob";
export const LEAST_B2B = 100;
/** The largest quick-pick the bKash app itself offers on its B2B screen; the database and the phone refuse more. */
export const MOST_B2B = 250000;
export const B2B_AMOUNTS = [5000, 10000, 25000, 50000, 100000];

/** Reads a typed amount ("25,000", "২৫০০০", "5000.50") within 100..250,000 with at most 2 decimals, or null. */
export function parseB2bAmount(raw: string): number | null {
  const bn = "০১২৩৪৫৬৭৮৯";
  const ascii = raw.replace(/[০-৯]/g, (d) => String(bn.indexOf(d))).replace(/[,\s]/g, "");
  if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(ascii)) return null;
  const n = Number(ascii);
  return Number.isFinite(n) && n >= LEAST_B2B && n <= MOST_B2B ? n : null;
}

/** "01324245010", "+880 1324-245010", "8801324245010" all read as 01324245010; anything else is null. */
export function normalizeDso(raw: string): string | null {
  let d = raw.replace(/[^0-9]/g, "");
  if (/^8801[0-9]{9}$/.test(d)) d = d.slice(2);
  return /^01[0-9]{9}$/.test(d) ? d : null;
}

/** The sentence the owner confirms. */
export const b2bSummary = (amount: number, dso: string, money: (n: number) => string): string =>
  `B2B ${money(amount)} from this phone's bKash wallet to the DSO ${dso}, through the bKash app.`;

/** The cash question bKash asks after every B2B; the phone answers it "yes" only because the owner ticks this. */
export const cashTick = (amount: number, money: (n: number) => string): string =>
  `The DSO pays me ${money(amount)} in cash for this B2B. (Right after a B2B, bKash asks the phone "Did you receive ` +
  `${money(amount)} cash from the DSO in person?"; with this ticked the phone answers yes. Without the answer the bKash app ` +
  `takes no other transaction.)`;

const B2B_ERRORS: Record<string, string> = {
  unsupported: "That phone's PayTrace app is too old for a B2B. Update the app on the phone and try again.",
  dso_does_not_match: "The bKash app showed a different DSO number from the one saved here, so the phone stopped before typing anything. NOTHING was sent. Check the DSO number saved on this card.",
  b2b_question_open: "The bKash app is still asking about the cash of an earlier B2B (\"did you receive the cash from the DSO?\"). Answer it on the phone, then try again. Nothing was sent.",
  bad_b2b: "The phone refused the amount or the number as not sane. Nothing was sent.",
  confirm_does_not_match: "The bKash app's own screen did not show this DSO number and this amount, so the phone stopped before the tap and hold. NOTHING was sent.",
  app_stopped_before_send: "The bKash app B2B stopped before the tap and hold, so nothing was sent. The phone's log below says where.",
  pin_refused: "The bKash app did not accept the PIN on the B2B. It was not typed again and nothing was sent. Check the bKash PIN saved in the phone app.",
  no_answer_after_hold: "The bKash app was told to send (tap and hold) but no result screen came back. The B2B may have gone: check the bKash app's transaction list before sending again.",
};

/** The B2B's own wording for an error, else [other] (the shared phone-command wording). */
export const b2bErrorText = (code: string | null | undefined, other: (code: string | null) => string): string =>
  (code && B2B_ERRORS[code]) || other(code ?? null);

/** The phone's own summary of a finished B2B ("… NOTE: …", and whether bKash's cash question was answered). */
export function b2bNotes(c: Pick<PhoneCommand, "screens"> | null): string[] {
  const s = (c?.screens ?? [])[0] ?? "";
  return s.split("\n").filter((l) => l.startsWith("NOTE:") || l.startsWith("bKash asks") || l.startsWith("bKash asked") || l.startsWith("bKash did not ask"));
}

/** One line for the phone card. */
export function b2bLine(c: PhoneCommand | null, money: (n: number) => string, when: (t: string) => string,
                        other: (code: string | null) => string): string {
  if (!c) return "";
  const amt = c.amount == null ? "–" : money(c.amount);
  switch (c.status) {
    case "queued": return "Waking the phone to take it now (within 30 seconds at worst)…";
    case "running": return "The phone is doing the B2B in the bKash app (about a minute and a half)…";
    case "done":
      return `B2B ${amt} to the DSO ${c.to_number ?? "–"}${c.trx_id ? `, receipt ${c.trx_id}` : ""}` +
        `${c.balance == null ? "" : `, bKash balance now ${money(c.balance)}`} (${when(c.finished_at ?? c.created_at)})`;
    case "cancelled":
    case "failed":
      return `The B2B of ${amt} at ${when(c.finished_at ?? c.created_at)} did not go through. ${b2bErrorText(c.error, other)}`;
  }
}
