// "Needs you" on the Home page (owner 2026-11-13): the things only a person can settle were spread over eight pages.
// This turns plain counts into one short list, worst first, each one tap from the page that fixes it. Pure: no I/O,
// no imports, so it runs in the node tests. A count of null means "could not be checked" and is SAID, never read as 0.

export interface NeedCounts {
  /** Payments held on Review (status review). */
  held: number | null;
  /** Job submissions waiting for the owner's Accept / Reject (both kinds). */
  jobsWaiting: number | null;
  /** Payouts where the phone stopped after the PIN and nobody knows whether the money went. */
  payoutsUnsure: number | null;
  /** The same for commission payments. */
  commissionUnsure: number | null;
  /** Finished days of commission not paid yet. */
  commissionDue: { partners: number; amount: number } | null;
  /** Approved phones that are not online right now. */
  phonesOffline: string[] | null;
  /** Approved phones on an older app build. */
  phonesOutdated: string[] | null;
  /** Wallet types no connected phone has a deposit number for. */
  numbersMissing: string[] | null;
  /** Live deposit numbers that are not valid numbers. */
  numbersInvalid: number | null;
  /** Result messages to websites that were given up on in the last 24 hours. */
  webhooksFailed: number | null;
  /** USDT transfers that matched no order. */
  cryptoReview: number | null;
}

/** The page ids used here are the stable ones in lib/nav.ts (a test checks every one exists). */
export type NeedPage = "review" | "jobs" | "payout" | "commission" | "devices" | "api" | "crypto";

export interface Need {
  id: string;
  /** "bad" = money or customers are affected right now; "warn" = waiting for a decision. */
  tone: "bad" | "warn";
  title: string;
  detail: string;
  page: NeedPage;
  /** What the button on the right says. */
  action: string;
}

const WALLET: Record<string, string> = { bkash: "bKash", nagad: "Nagad", rocket: "Rocket", upay: "Upay" };
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const taka = (n: number) => "Tk " + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** "Vivo", "Vivo and Redmi", "Vivo, Redmi and 2 more". */
export function nameList(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

/** The list, worst first. Nothing is listed for a zero or an unknown count. */
export function needs(c: NeedCounts): Need[] {
  const out: Need[] = [];
  if (c.phonesOffline?.length) {
    out.push({
      id: "offline", tone: "bad", page: "devices", action: "Open Phones",
      title: `${plural(c.phonesOffline.length, "phone")} offline`,
      detail: `${nameList(c.phonesOffline)}: payments to ${c.phonesOffline.length === 1 ? "its" : "their"} numbers are not seen until ${c.phonesOffline.length === 1 ? "it is" : "they are"} back.`,
    });
  }
  const unsure = (c.payoutsUnsure ?? 0) + (c.commissionUnsure ?? 0);
  if (unsure > 0) {
    out.push({
      id: "unsure", tone: "bad", page: (c.payoutsUnsure ?? 0) > 0 ? "payout" : "commission", action: "Settle",
      title: `${plural(unsure, "payment")} sent or not? PayTrace cannot tell`,
      detail: "The phone stopped after the PIN. Check the wallet and say whether the money went, so it is never paid twice.",
    });
  }
  if ((c.numbersInvalid ?? 0) > 0 || c.numbersMissing?.length) {
    const parts: string[] = [];
    if (c.numbersMissing?.length) parts.push(`no ${nameList(c.numbersMissing.map((p) => WALLET[p] ?? p))} number for customers to pay to`);
    if ((c.numbersInvalid ?? 0) > 0) parts.push(`${plural(c.numbersInvalid!, "number")} that cannot be a real number`);
    out.push({
      id: "numbers", tone: "bad", page: "devices", action: "Fix numbers",
      title: "Deposit numbers need attention",
      detail: parts.join("; ").replace(/^./, (ch) => ch.toUpperCase()) + ".",
    });
  }
  if ((c.webhooksFailed ?? 0) > 0) {
    out.push({
      id: "webhooks", tone: "bad", page: "api", action: "Open Websites",
      title: `${plural(c.webhooksFailed!, "result")} could not be delivered to a website`,
      detail: "In the last 24 hours. The website has not heard that these deposits were paid or expired.",
    });
  }
  if ((c.held ?? 0) > 0) {
    out.push({
      id: "held", tone: "warn", page: "review", action: "Review",
      title: `${plural(c.held!, "payment")} held for review`,
      detail: "Not credited until you credit or ignore each one.",
    });
  }
  if ((c.jobsWaiting ?? 0) > 0) {
    out.push({
      id: "jobs", tone: "warn", page: "jobs", action: "Open Jobs",
      title: `${plural(c.jobsWaiting!, "job")} waiting for your OK`,
      detail: "A partner says they sent the money. Accept it once it reached you, or reject it.",
    });
  }
  if (c.commissionDue && c.commissionDue.partners > 0 && c.commissionDue.amount > 0) {
    out.push({
      id: "commission", tone: "warn", page: "commission", action: "Pay",
      title: `${taka(c.commissionDue.amount)} commission due`,
      detail: `To ${plural(c.commissionDue.partners, "partner")}, for days that have ended.`,
    });
  }
  if ((c.cryptoReview ?? 0) > 0) {
    out.push({
      id: "crypto", tone: "warn", page: "crypto", action: "Open Crypto",
      title: `${plural(c.cryptoReview!, "USDT transfer")} matched no order`,
      detail: "Money arrived at your address with an amount no open order was waiting for.",
    });
  }
  if (c.phonesOutdated?.length) {
    out.push({
      id: "outdated", tone: "warn", page: "devices", action: "Open Phones",
      title: `${plural(c.phonesOutdated.length, "phone")} on an old app`,
      detail: `${nameList(c.phonesOutdated)}: open PayTrace on ${c.phonesOutdated.length === 1 ? "that phone" : "those phones"} and tap Update.`,
    });
  }
  return out;
}

const CHECK_NAMES: Record<keyof NeedCounts, string> = {
  held: "held payments", jobsWaiting: "jobs", payoutsUnsure: "payouts", commissionUnsure: "commission payments",
  commissionDue: "commission due", phonesOffline: "phones", phonesOutdated: "app versions", numbersMissing: "deposit numbers",
  numbersInvalid: "deposit numbers", webhooksFailed: "website results", cryptoReview: "USDT transfers",
};

/** What could not be checked this time, in words, each named once. */
export function unchecked(c: NeedCounts): string[] {
  const names = (Object.keys(CHECK_NAMES) as Array<keyof NeedCounts>).filter((k) => c[k] === null).map((k) => CHECK_NAMES[k]);
  return [...new Set(names)];
}

/** Small numbers for the menu: what to show beside a section's name. */
export function sectionBadges(c: Pick<NeedCounts, "held" | "jobsWaiting" | "payoutsUnsure" | "commissionUnsure">): Record<"transactions" | "jobs" | "payout", number> {
  return { transactions: c.held ?? 0, jobs: c.jobsWaiting ?? 0, payout: (c.payoutsUnsure ?? 0) + (c.commissionUnsure ?? 0) };
}
