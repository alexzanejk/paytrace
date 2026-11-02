/** Commands sent to a phone from the dashboard (step 1: read the Nagad balance by USSD). Pure helpers, tested in tests/phoneCommands.test.ts. */

export interface PhoneCommand {
  id: string;
  kind: string;
  provider: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  balance: number | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  /** Cash-in only: how much, to whom, and the wallet's own receipt number once it is through. */
  amount?: number | null;
  to_number?: string | null;
  trx_id?: string | null;
}

/** The amounts the dashboard offers for a cash-in. The database refuses anything over MOST_PER_CASH_IN whatever is sent. */
export const CASH_IN_AMOUNTS = [3000, 4000, 5000, 6000, 8000, 10000];
export const MOST_PER_CASH_IN = 10000;

/** A Bangladesh mobile number, the only kind money may be sent to. */
export const looksLikeANumber = (n: string): boolean => /^01[0-9]{9}$/.test(n.trim());

/** What the owner is about to do, in words, for the confirmation box. Never shortened: this is the last chance to see it. */
export const cashInSummary = (wallet: string, amount: number, to: string, money: (n: number) => string): string =>
  `Send ${money(amount)} from this phone's ${wallet} wallet to ${to}.`;

/** A command is "live" while the phone has not finished it. */
export const isLive = (c: Pick<PhoneCommand, "status"> | null | undefined): boolean => !!c && (c.status === "queued" || c.status === "running");

/** The phone answers within about 90 seconds; the server gives up on a running one after 3 minutes and a waiting one after 10. */
export const POLL_MS = 3000;

const ERROR_TEXT: Record<string, string> = {
  not_allowed: "The switch on that phone is off. Turn it on in the app: Settings, Nagad balance check.",
  no_accessibility: "PayTrace is not switched on in that phone's Accessibility settings.",
  no_call_permission: "That phone has not allowed phone calls for PayTrace.",
  no_pin: "No Nagad PIN is saved on that phone.",
  busy: "That phone was already busy with a check. Try again in a minute.",
  network_refused: "The wallet answered that its service is not available right now. Try again a little later.",
  too_soon: "That phone had just finished a check. Wait about a minute and try again.",
  ussd_failed: "The network did not answer the code. The phone did not try again. Check the Nagad SMS, then try again later.",
  timeout: "The phone did not answer in time.",
  no_answer_after_pin: "The PIN was entered but no balance came back. The phone did not try the PIN again. Check the Nagad SMS, then try again later.",
  unexpected_screen: "The Nagad menu looked different from what PayTrace expects, so it stopped. Nothing was sent.",
  too_many_steps: "The Nagad menu took too many steps, so it stopped.",
  no_input_box: "PayTrace could not use the phone's menu box.",
  no_send_button: "PayTrace could not use the phone's menu box.",
  sim_not_found: "The phone could not pick the Nagad SIM. Check the SIM number in the app's settings.",
  dial_failed: "The phone could not start the code.",
  unsupported: "That phone's app is too old for this. Update the app.",
  cash_in_off: "Cash-in is switched off on that phone. Turn it on in the app: Settings, Balance check.",
  bad_cash_in: "The phone refused the amount or the number. Nothing was sent.",
  confirm_does_not_match: "The wallet's own screen did not show this number and this amount, so the phone stopped before the PIN. NOTHING was sent.",
  wallet_refused: "The wallet itself said no (for example the amount is under its minimum, or the PIN was wrong). Nothing was sent.",
  bad_entry: "That is not a statement entry the phone can ask for.",
  entry_not_found: "The wallet's statement does not go back far enough to show that entry.",
  dialled_as_call: "The phone turned the menu code into an ordinary call. Nothing was sent. Try again.",
  sim_no_service: "The SIM chosen on that phone has no network. Choose the other SIM in the app.",
  expired: "The phone never picked it up (it may be offline or asleep).",
  failed: "It did not work.",
};

export const errorText = (code: string | null): string => (code ? ERROR_TEXT[code] ?? ERROR_TEXT.failed : ERROR_TEXT.failed);

/** One line for the phone card. [money] formats a number as taka. */
export function commandLine(c: PhoneCommand | null, money: (n: number) => string, when: (t: string) => string, label = "Nagad"): string {
  if (!c) return "";
  const cashIn = c.kind === "cashin";
  switch (c.status) {
    case "queued": return "Waiting for the phone to pick it up (it checks every 30 seconds)…";
    case "running": return cashIn ? "The phone is sending it…" : "The phone is reading the balance…";
    case "done":
      return cashIn
        ? `Sent ${c.amount == null ? "–" : money(c.amount)} to ${c.to_number ?? "–"}${c.trx_id ? `, receipt ${c.trx_id}` : ""}` +
          `${c.balance == null ? "" : `, ${label} balance now ${money(c.balance)}`} (${when(c.finished_at ?? c.created_at)})`
        : `${label} balance ${c.balance == null ? "–" : money(c.balance)} as of ${when(c.finished_at ?? c.created_at)}`;
    case "cancelled":
    case "failed":
      return cashIn
        ? `The cash-in of ${c.amount == null ? "–" : money(c.amount)} at ${when(c.finished_at ?? c.created_at)} did not go through. ${errorText(c.error)}`
        : `Last check ${when(c.finished_at ?? c.created_at)} did not work. ${errorText(c.error)}`;
  }
}
