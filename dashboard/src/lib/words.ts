/** Plain words for everything the dashboard shows the team (owner request 2026-11-03: "I don't even understand what is
 *  what, let alone our team"), ALIGNED WITH ADMIN HUB (owner, same day: "PayTrace is basically Admin Hub's payment
 *  automation — match its wording"). ONE place: every page, badge, filter and the Help page read from here.
 *
 *  Admin Hub's words, read from its code (`src/routes/_authenticated/transactions.tsx`, `src/lib/paytrace.ts`,
 *  `src/components/console-ui.tsx`, `src/lib/i18n.tsx`): pages "Transactions Stream", "Overview Dashboard";
 *  types "Deposits / Withdrawals / Turnover payments / Deposit orders"; wallets are "gateways" (bKash, Nagad, Rocket);
 *  the person is a "player"; approval is "Waiting / Approved / Rejected / Turnover hold / Cancelled"; and the PayTrace
 *  column shows VERIFIED or UNVERIFIED, with "held for review" and "used twice" as suffixes. Its own tooltip sends
 *  people to "the Review page in PayTrace", so that page keeps its name. The database keeps its codes (`matched`,
 *  `tracked_only`, ...); these are only what people see. Tested in tests/words.test.ts. */

export type Tone = "ok" | "warn" | "info" | "bad" | "idle";

export interface Word {
  /** What is printed. Short enough for a badge. */
  label: string;
  /** One sentence a new team member can act on. Shown as a tooltip and on the Help page. */
  meaning: string;
  tone: Tone;
}

/** A payment's status: what has happened to the money since the SMS arrived. */
export const PAYMENT_STATUS: Record<string, Word> = {
  matched: { label: "Credited to order", meaning: "This money was credited to a deposit order. Nothing to do.", tone: "ok" },
  unmatched: {
    label: "Received, no order",
    meaning: "Money arrived but no deposit order was waiting for it. Not a problem. It can be credited by hand later if an order turns up.",
    tone: "idle",
  },
  tracked_only: {
    label: "Agent cash-out",
    meaning: "A player took cash out through your agent number. Counted in the totals; it never pays an order by itself.",
    tone: "info",
  },
  review: {
    label: "Held for review",
    meaning: "Arrived but did not match any order (wrong amount, other number, expired order, or an unfamiliar message). Nothing is credited until a person decides. Admin Hub shows it as HELD FOR REVIEW.",
    tone: "warn",
  },
  ignored: { label: "Ignored", meaning: "A person decided this will never be credited. Kept for the record. Admin Hub shows it as UNVERIFIED.", tone: "bad" },
};

/** What Admin Hub's "PayTrace" column shows for a payment in each status. The bridge between the two apps: the team
 *  sees the same word in both places. From Admin Hub's own mapping: found = VERIFIED, found-but-held = HELD FOR
 *  REVIEW, not found = UNVERIFIED. */
export const HUB_VIEW: Record<string, Word> = {
  matched: { label: "VERIFIED", meaning: "Admin Hub finds this TrxID in PayTrace with the same amount.", tone: "ok" },
  unmatched: { label: "VERIFIED", meaning: "Admin Hub finds this TrxID in PayTrace with the same amount.", tone: "ok" },
  tracked_only: { label: "VERIFIED", meaning: "Admin Hub finds this TrxID in PayTrace with the same amount.", tone: "ok" },
  review: { label: "HELD FOR REVIEW", meaning: "Admin Hub sees that PayTrace has the message but is holding it. Decide on the Review page and the badge changes.", tone: "warn" },
  ignored: { label: "UNVERIFIED", meaning: "Admin Hub does not find this TrxID in PayTrace, because it was ignored.", tone: "bad" },
};

export const hubView = (status: string): Word => HUB_VIEW[status] ?? { label: "—", meaning: "Admin Hub has no view of this.", tone: "idle" };

/** A deposit order's status, in Admin Hub's approval words where they mean the same thing. */
export const ORDER_STATUS: Record<string, Word> = {
  pending: { label: "Waiting", meaning: "Waiting for the player's payment. A payment of this exact amount will be credited to it by itself.", tone: "warn" },
  paid: { label: "Paid", meaning: "A payment matched this order and was credited to it. Admin Hub approves the deposit on its own side.", tone: "ok" },
  review: { label: "Held for review", meaning: "A payment came for this order but did not match exactly. Decide on the Review page.", tone: "warn" },
  expired: { label: "Expired", meaning: "The time ran out and no payment matched. Most website deposits end this way (the player started and gave up). A late payment would go to Review.", tone: "bad" },
  cancelled: { label: "Cancelled", meaning: "Cancelled by a person. It will not take a payment.", tone: "bad" },
};

/** Other statuses the badge may meet (phones, webhooks, crypto). Tone only; the word is the code itself. */
export const OTHER_STATUS_TONE: Record<string, Tone> = {
  approved: "ok", sent: "ok", revoked: "bad", failed: "bad", new: "info", running: "info", queued: "idle", done: "ok",
};

/** What kind of SMS it was, and which way the money went. */
export interface TypeWord {
  label: string;
  meaning: string;
  /** "in" = money came INTO your wallet; "out" = money left it; null = unclear. */
  direction: "in" | "out" | null;
}

export const PAYMENT_TYPE: Record<string, TypeWord> = {
  payment_received: { label: "Payment in", meaning: "A player paid your merchant number.", direction: "in" },
  send_money_received: { label: "Send Money in", meaning: "A player sent money to your personal number (the Send Money method).", direction: "in" },
  cash_out: { label: "Cash Out in", meaning: "A player paid through your agent number (the Cash Out method): the money came into the agent wallet.", direction: "in" },
  unknown: { label: "Unclear message", meaning: "PayTrace could not tell what kind of transaction this was. Held for a person to look at.", direction: null },
};

/** The balance check, said plainly. A forged SMS cannot know the live balance, so "Yes" is real reassurance; "Can't
 *  tell" is only a flag, because cash-in and send money also move the balance without any SMS. */
export const GENUINE: Record<string, Word> = {
  ok: { label: "Yes", meaning: "The balance printed in this SMS follows on from the one before it. A forged message could not do that.", tone: "ok" },
  mismatch: {
    label: "Can't tell",
    meaning: "The balance jumped between this SMS and the one before. Usually a cash-in or send-money in between (those send no SMS). Not proof of anything.",
    tone: "warn",
  },
  none: { label: "Not checked", meaning: "This message carried no balance, or it was the first one from this wallet.", tone: "idle" },
};

export const genuineWord = (status: string | null): Word => GENUINE[status ?? "none"] ?? GENUINE.none;

/** The three money pages, in the words the Help page and each page's intro use. The sentences are deliberately the
 *  same in both places: a person who read the intro once should recognise them on the Help page. */
export interface PageIntro {
  title: string;
  /** One line: what this page IS. */
  what: string;
  /** Up to three lines: what you do here, what you do not need to do. */
  lines: string[];
}

export const PAGE_INTRO: Record<"payments" | "review" | "orders" | "overview", PageIntro> = {
  overview: {
    title: "Overview",
    what: "Today's money at a glance, per phone and per gateway.",
    lines: ["Nothing to do here; it is for looking."],
  },
  payments: {
    title: "Transactions",
    what: "Every payment SMS your phones received. This is the money that actually arrived; Admin Hub's Transactions Stream checks against it.",
    lines: [
      "Each row is one SMS from a gateway (bKash, Nagad, Rocket or Upay). Open a row to read the SMS itself and see what Admin Hub shows for it.",
      "\"Credited to order\" means it paid a deposit order. \"Received, no order\" is fine: money came, nothing was waiting for it.",
      "You do not act here. Decisions are made on the Review page.",
    ],
  },
  review: {
    title: "Review",
    what: "Payments held for review: they arrived but did not match any deposit order. Nothing here is credited until you decide.",
    lines: [
      "For each one: pick the order it belongs to and press Credit, or press Ignore if it belongs to none.",
      "Why it is held is written on the card (wrong amount, a different number, the order had expired, an unfamiliar message).",
      "While it sits here, Admin Hub shows the player's deposit as HELD FOR REVIEW. Your decision changes that badge.",
    ],
  },
  orders: {
    title: "Deposit orders",
    what: "Money that is EXPECTED: a deposit a player started on one of your sites, or an order you typed in here.",
    lines: [
      "An order waits for a payment of the same amount. When the SMS arrives it is credited automatically and the order turns Paid.",
      "\"Expired\" is normal: most website deposits are started and abandoned. They are hidden by default.",
      "Cancel stops a waiting order from ever taking a payment.",
    ],
  },
};

/** How the three pages fit together: the one picture the team needs. */
export const HOW_IT_FITS = [
  { page: "Deposit orders", says: "A player is about to pay 500 Tk on one of your sites.", word: "expected" },
  { page: "Transactions", says: "An SMS says 500 Tk arrived in a gateway wallet.", word: "arrived" },
  { page: "Review", says: "The 500 Tk arrived but no order matched it exactly, so a person decides.", word: "held" },
];

/** Admin Hub's word next to PayTrace's, for the Help page. */
export const SAME_THING: { hub: string; here: string; note: string }[] = [
  { hub: "Transactions Stream", here: "Transactions", note: "Admin Hub lists what players submitted; PayTrace lists the SMS that actually arrived. The PayTrace column in Admin Hub compares the two." },
  { hub: "Deposit orders", here: "Deposit orders", note: "The same orders. Admin Hub creates them when a player presses Deposit; PayTrace waits for their money." },
  { hub: "PayTrace: VERIFIED", here: "Credited to order / Received, no order / Agent cash-out", note: "The TrxID was found in PayTrace with the same amount." },
  { hub: "PayTrace: HELD FOR REVIEW", here: "Held for review (the Review page)", note: "PayTrace has the SMS but a person has not decided yet." },
  { hub: "PayTrace: UNVERIFIED", here: "Ignored, or no SMS at all", note: "No such TrxID in PayTrace. Either the player typed a wrong TrxID, or the SMS never arrived." },
  { hub: "Gateway", here: "Gateway", note: "bKash, Nagad, Rocket, Upay. The same word in both." },
  { hub: "Player", here: "Player", note: "The person who pays. Typed-in orders may say Customer." },
  { hub: "Approval: Waiting / Approved / Rejected", here: "(Admin Hub only)", note: "Approval is Admin Hub's decision about the player's deposit. PayTrace never approves anything; it only says whether the money arrived." },
];
