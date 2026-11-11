/** How a phone sends money: by USSD (*247#) or through the bKash app (owner 2026-11-10: "keep both ussd and app, i should be
 *  able to select an option when we do cashin, commission payout, payout"; migration 082). The app way is a bKash agent Cash
 *  In only, and only from a phone whose app build reported `app_cashin`; the database refuses anything else as well. */
export type SendWay = "ussd" | "app";

export const WAY_LABEL: Record<SendWay, string> = { ussd: "USSD (*247#)", app: "bKash app" };

export interface AppWayInput {
  provider: string;
  /** agent | personal; a personal account sends by Send Money, which has no app way. */
  account?: string;
  /** cash_in | send_money (commission payouts); only a Cash In has an app way. */
  method?: string;
  /** The phone's heartbeat `app_cashin`. */
  appCashin?: unknown;
}

/** Whether the bKash app way can be chosen, and if not, why, in words. */
export function appWayFor(o: AppWayInput): { ok: boolean; why: string } {
  if (o.provider !== "bkash") return { ok: false, why: "Only bKash can send through its app; this one goes by USSD." };
  if (o.account === "personal" || o.method === "send_money") return { ok: false, why: "Send Money from a personal account goes by USSD only." };
  if (o.appCashin !== true) return { ok: false, why: "This phone's PayTrace app is too old for the app way. Update it to the newest version." };
  return { ok: true, why: "" };
}

/** The way actually sent to the server: the app only when it is allowed. */
export const wayToSend = (chosen: SendWay, o: AppWayInput): SendWay => (chosen === "app" && appWayFor(o).ok ? "app" : "ussd");

/** A few words for the confirm sentence. */
export const wayWords = (w: SendWay): string => (w === "app" ? "through the bKash app (tap and hold)" : "by USSD (*247#)");

/** The balance check's own app way (migration 089, owner 2026-11-11: "yes build balance check in app"): bKash only, and only
 *  from a phone whose app build reported `app_balance`. Only reads; nothing is sent. */
export function appBalanceFor(provider: string, appBalance: unknown): { ok: boolean; why: string } {
  if (provider !== "bkash") return { ok: false, why: "Only bKash can be read in its app." };
  if (appBalance !== true) return { ok: false, why: "This phone's PayTrace app is too old to read the balance in the bKash app. Update it to the newest version." };
  return { ok: true, why: "" };
}
