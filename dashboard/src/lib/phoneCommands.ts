/** Commands sent to a phone from the dashboard (step 1: read the Nagad balance by USSD). Pure helpers, tested in tests/phoneCommands.test.ts. */

export interface PhoneCommand {
  id: string;
  kind: string;
  /** The wallet a balance / cash-in / statement works on. A phone control (restart, inbox, …) has none. */
  provider: string | null;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  balance: number | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  /** Cash-in only: how much, to whom, and the wallet's own receipt number once it is through. */
  amount?: number | null;
  to_number?: string | null;
  trx_id?: string | null;
  /** The wallet's screens (statement), and for a failed run the phone's step log (see traceOf). */
  screens?: string[] | null;
}

/** The wallets a phone can be asked to work with. Rocket joined on 2026-11-02 from the owner's own recordings. */
export type WalletName = "nagad" | "bkash" | "rocket";
export const WALLETS: WalletName[] = ["nagad", "bkash", "rocket"];
export const walletLabel = (w: WalletName): string => (w === "bkash" ? "bKash" : w === "rocket" ? "Rocket" : "Nagad");

/** Quick picks for a cash-in; any exact amount within the bounds can be typed too (owner 2026-11-04). The database refuses
 *  anything outside LEAST..MOST whatever is sent, and so does the phone. */
export const CASH_IN_AMOUNTS = [1000, 2000, 5000, 10000, 20000, 50000];
export const LEAST_PER_CASH_IN = 100;
export const MOST_PER_CASH_IN = 50000;

/** Reads a typed amount ("5,000", "৫০০০", "2500.50"): a number within the bounds with at most 2 decimals, or null. */
export function parseCashInAmount(raw: string): number | null {
  const bn = "০১২৩৪৫৬৭৮৯";
  const ascii = raw.replace(/[০-৯]/g, (d) => String(bn.indexOf(d))).replace(/[,\s]/g, "");
  if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(ascii)) return null;
  const n = Number(ascii);
  return Number.isFinite(n) && n >= LEAST_PER_CASH_IN && n <= MOST_PER_CASH_IN ? n : null;
}

/** One of the owner's saved cash-in numbers (the Jobs page keeps them). Money may only be sent to one of these. */
export interface SavedNumber {
  id: string;
  provider: string;
  number: string;
  label: string | null;
  enabled: boolean;
}
export const numberLabel = (n: SavedNumber): string => (n.label ? `${n.label} · ${n.number}` : n.number);

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
  not_allowed: "Balance checks are switched off for that phone. Turn them on in its card under \"What the dashboard may do\".",
  no_accessibility: "PayTrace is not switched on in that phone's Accessibility settings.",
  accessibility_not_running: "That phone says PayTrace is switched on in Accessibility, but it never actually started it, so nothing was watching the screen. On the phone: Settings, Accessibility, Downloaded apps, switch PayTrace OFF and ON again. On Xiaomi/Redmi also allow \"Display pop-up windows while running in the background\".",
  no_call_permission: "That phone has not allowed phone calls for PayTrace.",
  no_pin: "No Nagad PIN is saved on that phone.",
  busy: "That phone was already busy with a check. Try again in a minute.",
  network_refused: "The wallet answered that its service is not available right now. Try again a little later.",
  too_soon: "That phone had just finished a check. Wait about a minute and try again.",
  ussd_failed: "The network did not answer the code. The phone did not try again. Check the Nagad SMS, then try again later.",
  timeout: "The phone did not answer in time.",
  no_answer_after_pin: "The PIN was entered but no balance came back. The phone did not try the PIN again. Check the Nagad SMS, then try again later.",
  unexpected_screen: "The wallet's menu looked different from what PayTrace expects, so it stopped. Nothing was sent.",
  too_many_steps: "The Nagad menu took too many steps, so it stopped.",
  no_input_box: "PayTrace could not use the phone's menu box.",
  no_send_button: "PayTrace could not use the phone's menu box.",
  sim_not_found: "The phone could not pick the Nagad SIM. Check the SIM number in the app's settings.",
  dial_failed: "The phone could not start the code.",
  unsupported: "That phone's app is too old for this. Update the app.",
  cash_in_off: "Sending money is switched off for that phone. Turn it on in its card under \"What the dashboard may do\".",
  bad_cash_in: "The phone refused the amount or the number. Nothing was sent.",
  confirm_does_not_match: "The wallet's own screen did not show this number and this amount, so the phone stopped before the PIN. NOTHING was sent.",
  wallet_refused: "The wallet itself said no (for example the amount is under its minimum, or the PIN was wrong). Nothing was sent.",
  phone_locked: "That phone has a screen lock (PIN, pattern or fingerprint). Android does not let any app open a locked phone, so the wallet's menu cannot be reached. Take the screen lock off that phone, or unlock it by hand and try again.",
  bad_entry: "That is not a statement entry the phone can ask for.",
  entry_not_found: "The wallet's statement does not go back far enough to show that entry.",
  dialled_as_call: "The phone turned the menu code into an ordinary call. Nothing was sent. Try again.",
  sim_no_service: "The SIM chosen on that phone has no network. Choose the other SIM in the app.",
  expired: "The phone never picked it up (it may be offline or asleep).",
  failed: "It did not work.",
};

/** The reason in words. With [wallet] ("bKash") the text names that wallet instead of "the wallet". */
export const errorText = (code: string | null, wallet?: string): string => {
  const t = code ? ERROR_TEXT[code] ?? ERROR_TEXT.failed : ERROR_TEXT.failed;
  return wallet ? t.replace("The wallet's menu", `The ${wallet} menu`) : t;
};

/** The phone's own step log of a failed run rides along as a "screen" that starts with this line (never the PIN). */
export const TRACE_MARK = "What the phone saw:";
export const traceOf = (screens: string[] | null | undefined): string | null => {
  const t = (screens ?? []).find((s) => s.startsWith(TRACE_MARK));
  return t ? t.slice(TRACE_MARK.length).trim() : null;
};
/** The wallet's screens without the step log. */
export const walletScreens = (screens: string[] | null | undefined): string[] => (screens ?? []).filter((s) => !s.startsWith(TRACE_MARK));

/** One line for the phone card. [money] formats a number as taka. */
export function commandLine(c: PhoneCommand | null, money: (n: number) => string, when: (t: string) => string, label = "Nagad"): string {
  if (!c) return "";
  const cashIn = c.kind === "cashin";
  switch (c.status) {
    // The dashboard pokes the phone the moment a command is queued, so this is usually a second or two. A phone that
    // the wake-up cannot reach still takes it on its own 30-second beat, so the line promises the slower one.
    case "queued": return "Waking the phone to take it now (within 30 seconds at worst)…";
    case "running": return cashIn ? "The phone is sending it…" : "The phone is reading the balance…";
    case "done":
      return cashIn
        ? `Sent ${c.amount == null ? "–" : money(c.amount)} to ${c.to_number ?? "–"}${c.trx_id ? `, receipt ${c.trx_id}` : ""}` +
          `${c.balance == null ? "" : `, ${label} balance now ${money(c.balance)}`} (${when(c.finished_at ?? c.created_at)})`
        : `${label} balance ${c.balance == null ? "–" : money(c.balance)} as of ${when(c.finished_at ?? c.created_at)}`;
    case "cancelled":
    case "failed":
      return cashIn
        ? `The cash-in of ${c.amount == null ? "–" : money(c.amount)} at ${when(c.finished_at ?? c.created_at)} did not go through. ${errorText(c.error, label)}`
        : `Last check ${when(c.finished_at ?? c.created_at)} did not work. ${errorText(c.error, label)}`;
  }
}

// ---- Phone controls (owner request 2026-11-02): commands that need no wallet ----

export type PhoneActionKind = "restart" | "inbox" | "resend" | "screen" | "ring";

export interface PhoneAction {
  kind: PhoneActionKind;
  /** The button. */
  label: string;
  /** What the phone is doing while the command is live. */
  busy: string;
  /** Said when it finished well. */
  done: string;
  /** One line of why, shown as the button's tooltip. */
  help: string;
}

/** The phone's PhoneActions.KINDS must name exactly these. What Android cannot do is left out on purpose: switching a
 *  phone on from off, rebooting it, or toggling Wi-Fi / mobile data / flight mode — no app may. */
export const PHONE_ACTIONS: PhoneAction[] = [
  { kind: "restart", label: "Restart PayTrace", busy: "Restarting PayTrace on the phone…", done: "PayTrace was restarted",
    help: "Stops and starts PayTrace's always-on service. For a phone that shows Online but does nothing." },
  { kind: "inbox", label: "Read inbox now", busy: "Reading the phone's SMS inbox…", done: "Inbox read; anything missed was picked up",
    help: "Reads the phone's SMS inbox right now instead of on the next 5-minute pass." },
  { kind: "resend", label: "Send waiting now", busy: "Sending what was waiting…", done: "Waiting messages were sent",
    help: "Sends every message still waiting, including ones that failed only because the internet was down." },
  { kind: "screen", label: "Wake screen", busy: "Waking the screen…", done: "Screen woken, held on for 2 minutes",
    help: "Turns the screen on and keeps it on for two minutes." },
  { kind: "ring", label: "Ring", busy: "Ringing…", done: "The phone rang",
    help: "Sounds the alarm tone for 20 seconds so whoever has the phone notices it." },
];

export const PHONE_ACTION_KINDS: PhoneActionKind[] = PHONE_ACTIONS.map((a) => a.kind);

export const isPhoneAction = (kind: string | null | undefined): kind is PhoneActionKind =>
  !!kind && PHONE_ACTION_KINDS.includes(kind as PhoneActionKind);

/** One line under the controls for the newest phone control, whichever it was. */
export function actionLine(c: PhoneCommand | null, when: (t: string) => string): string {
  if (!c || !isPhoneAction(c.kind)) return "";
  const a = PHONE_ACTIONS.find((x) => x.kind === c.kind)!;
  switch (c.status) {
    case "queued": return "Waking the phone to take it now (within 30 seconds at worst)…";
    case "running": return a.busy;
    case "done": return `${a.done} (${when(c.finished_at ?? c.created_at)})`;
    case "cancelled":
    case "failed":
      return `"${a.label}" at ${when(c.finished_at ?? c.created_at)} did not work. ${errorText(c.error)}`;
  }
}

// The one failure a phone control can report on its own; the rest come from the shared list above.
ERROR_TEXT.inbox_unreadable = "The phone could not read its SMS inbox: PayTrace has no SMS permission there, or forwarding is paused.";
