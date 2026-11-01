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
}

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
  expired: "The phone never picked it up (it may be offline or asleep).",
  failed: "It did not work.",
};

export const errorText = (code: string | null): string => (code ? ERROR_TEXT[code] ?? ERROR_TEXT.failed : ERROR_TEXT.failed);

/** One line for the phone card. [money] formats a number as taka. */
export function commandLine(c: PhoneCommand | null, money: (n: number) => string, when: (t: string) => string): string {
  if (!c) return "";
  switch (c.status) {
    case "queued": return "Waiting for the phone to pick it up (it checks every 30 seconds)…";
    case "running": return "The phone is reading the balance…";
    case "done": return `Nagad balance ${c.balance == null ? "–" : money(c.balance)} as of ${when(c.finished_at ?? c.created_at)}`;
    case "cancelled":
    case "failed": return `Last check ${when(c.finished_at ?? c.created_at)} did not work. ${errorText(c.error)}`;
  }
}
