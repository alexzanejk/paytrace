/** How a phone sends money: by USSD (*247# / *167#) or through the wallet's own app: the bKash app (owner 2026-11-10: "keep both ussd and app, i should be
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
  /** The phone's heartbeat `app_nagad` (the Nagad agent app, migration 093). */
  appNagad?: unknown;
}

/** The button's words for a way, for this wallet. */
export const wayLabel = (w: SendWay, provider?: string | null): string =>
  provider === "nagad" ? (w === "app" ? "Nagad app" : "USSD (*167#)")
    : provider === "rocket" ? (w === "app" ? "Rocket app" : "USSD (*322#)")
    : WAY_LABEL[w];

/** Whether the bKash app way can be chosen, and if not, why, in words. */
export function appWayFor(o: AppWayInput): { ok: boolean; why: string } {
  if (o.provider !== "bkash" && o.provider !== "nagad") return { ok: false, why: "Only bKash and Nagad can send through their app; this one goes by USSD." };
  if (o.account === "personal" || o.method === "send_money") return { ok: false, why: "Send Money from a personal account goes by USSD only." };
  if (o.provider === "nagad") {
    if (o.appNagad !== true) return { ok: false, why: "This phone's PayTrace app is too old for the Nagad app way. Update it to the newest version." };
    return { ok: true, why: "" };
  }
  if (o.appCashin !== true) return { ok: false, why: "This phone's PayTrace app is too old for the app way. Update it to the newest version." };
  return { ok: true, why: "" };
}

/** The way actually sent to the server: the app only when it is allowed. */
export const wayToSend = (chosen: SendWay, o: AppWayInput): SendWay => (chosen === "app" && appWayFor(o).ok ? "app" : "ussd");

/** A few words for the confirm sentence. */
export const wayWords = (w: SendWay, provider?: string | null): string =>
  provider === "nagad"
    ? (w === "app" ? "through the Nagad app (হ্যাঁ only when it shows this number and amount)" : "by USSD (*167#)")
    : provider === "rocket" ? "by USSD (*322#)"
    : (w === "app" ? "through the bKash app (tap and hold)" : "by USSD (*247#)");

/** The balance check's own app way (migration 089, owner 2026-11-11: "yes build balance check in app"): bKash only, and only
 *  from a phone whose app build reported `app_balance`. Only reads; nothing is sent. */
export function appBalanceFor(provider: string, appBalance: unknown, appNagad?: unknown): { ok: boolean; why: string } {
  if (provider === "nagad") {
    if (appNagad !== true) return { ok: false, why: "This phone's PayTrace app is too old to read the balance in the Nagad app. Update it to the newest version." };
    return { ok: true, why: "" };
  }
  if (provider !== "bkash") return { ok: false, why: "Only bKash and Nagad can be read in their app." };
  if (appBalance !== true) return { ok: false, why: "This phone's PayTrace app is too old to read the balance in the bKash app. Update it to the newest version." };
  return { ok: true, why: "" };
}
