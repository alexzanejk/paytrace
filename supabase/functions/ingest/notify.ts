// Telegram alerts for the owner. Plain text only (no parse_mode): SMS-derived text can never be
// turned into formatting or links. Sending never throws and never blocks a payment from being saved.
import type { Problem } from "./health.ts";

export interface Notifier {
  enabled: boolean;
  /** true when Telegram accepted the message. false when not configured or it failed. */
  send(text: string): Promise<boolean>;
}

export function makeNotifier(
  cfg: { token?: string; chatId?: string },
  fetchImpl: typeof fetch = fetch,
): Notifier {
  const token = (cfg.token ?? "").trim();
  const chatId = (cfg.chatId ?? "").trim();
  const enabled = token.length > 0 && chatId.length > 0;
  return {
    enabled,
    async send(text: string): Promise<boolean> {
      if (!enabled) return false;
      try {
        const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 3500), disable_web_page_preview: true }),
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) console.error("telegram rejected the message, status", res.status);
        return res.ok;
      } catch {
        // Deliberately not logging the error: a fetch failure message can contain the bot token in the URL.
        console.error("telegram request failed");
        return false;
      }
    },
  };
}

// ---------- wording ----------

const PROVIDER: Record<string, string> = { bkash: "bKash", nagad: "Nagad", rocket: "Rocket", upay: "Upay" };

/** Drops control characters and caps the length, for anything that came from outside. */
export function clean(s: unknown, max = 60): string {
  return String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export const taka = (n: number) =>
  "Tk " + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function duration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h < 24) return rest ? `${h} h ${rest} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} d ${h % 24} h`;
}

// Mirrors dashboard/src/lib/reasons.ts. The two run in different places, so each keeps its own copy.
const REASONS: [string, string][] = [
  ["amount_mismatch", "the amount does not match the order"],
  ["phone_mismatch", "it was paid from a different phone number"],
  ["order_expired_before_payment", "the order had already expired"],
  ["wrong_phone", "it arrived on a different phone than the number the customer was shown"],
  ["unsupported_type", "this kind of message cannot credit an order"],
  ["unrecognized_type", "could not tell what kind of payment this is"],
  ["unverified_format", "the message format is not confirmed yet"],
  ["balance_chain_mismatch", "the account balance does not follow the previous message, so it could be a fake SMS"],
  ["paid_before_order", "it was paid before the order was created, so it may be an older receipt"],
  ["cash_in_received", "money came in by Cash In from an agent; a customer may have paid at an agent counter, or it is your own top-up"],
];

export function reasonText(reason: string | null | undefined): string {
  if (!reason) return "it needs a person to decide";
  const hit = REASONS.find(([key]) => reason.startsWith(key));
  return hit ? hit[1] : clean(reason, 80);
}

export function reviewMessage(p: {
  provider: string;
  amount: number;
  trxId: string;
  reason: string | null;
  dashboardUrl: string;
}): string {
  return [
    "⚠️ Payment held for review",
    `${PROVIDER[p.provider] ?? clean(p.provider, 20)} ${taka(p.amount)}  ·  TrxID ${clean(p.trxId, 30)}`,
    `Why: ${reasonText(p.reason)}.`,
    "It has NOT been credited to any order.",
    `${p.dashboardUrl}/#/review`,
  ].join("\n");
}

/** A held payment the phone itself proved real (migration 053): it was released and matched like any other. */
export function confirmedMessage(p: { provider: string; amount: number; trxId: string; how: string; detail: string; result: string }): string {
  return [
    "✅ Held payment confirmed by the wallet",
    `${PROVIDER[p.provider] ?? clean(p.provider, 20)} ${taka(p.amount)}  ·  TrxID ${clean(p.trxId, 30)}`,
    clean(p.detail, 200),
    p.result === "matched" ? "The order it was for is now paid and the website has been told." : "No order was waiting for it; it is counted as received.",
  ].join("\n");
}

/** The phone could not prove the held payment: the owner decides on Review. */
export function notConfirmedMessage(p: { provider: string; amount: number; trxId: string; detail: string; dashboardUrl: string }): string {
  return [
    "⚠️ Held payment: the wallet could not confirm it",
    `${PROVIDER[p.provider] ?? clean(p.provider, 20)} ${taka(p.amount)}  ·  TrxID ${clean(p.trxId, 30)}`,
    clean(p.detail, 200),
    "It stays held for you to decide.",
    `${p.dashboardUrl}/#/review`,
  ].join("\n");
}

export function silentMessage(p: { name: string; code: string; minutes: number; dashboardUrl: string }): string {
  return [
    "📵 A phone is offline",
    `${clean(p.name) || "Unnamed phone"} (code ${clean(p.code, 12)}) has not been heard from for ${duration(p.minutes)}, so it is offline.`,
    "Payments sent to it may be missing. Check that it is on, has internet, and PayTrace is running.",
    `${p.dashboardUrl}/#/devices`,
  ].join("\n");
}

export function recoveredMessage(p: { name: string; code: string }): string {
  return `✅ ${clean(p.name) || "A phone"} (code ${clean(p.code, 12)}) is back online.`;
}

export function problemMessage(p: { name: string; code: string; problem: Problem; dashboardUrl: string }): string {
  const what =
    p.problem === "sms_permission_off"
      ? "SMS permission is switched off, so it cannot see any payment messages"
      : "monitoring is switched off in the app, so payments are NOT being forwarded";
  return [
    "🚫 A phone cannot capture payments",
    `${clean(p.name) || "Unnamed phone"} (code ${clean(p.code, 12)}): ${what}.`,
    `${p.dashboardUrl}/#/devices`,
  ].join("\n");
}

/** An SMS from a provider could not be read by the parser. Sent at most once per wallet type every 6 hours. */
export function unreadMessage(p: { provider: string | null; reason: string; dashboardUrl: string }): string {
  return [
    "⚠️ An SMS could not be read",
    `${p.provider ? (PROVIDER[p.provider] ?? clean(p.provider, 20)) : "Unknown wallet"}: ${clean(p.reason, 100)}`,
    "It was NOT counted and leaves a gap in the balance chain. The text is on the Activity log page (“parse failed”).",
    "After the next PayTrace update, press “Run the parser again” there to recover it.",
    `${p.dashboardUrl}/#/logs`,
  ].join("\n");
}

/** B2B money moved on an agent wallet (owner 2026-11-05: "if B2B is ever done by our money we should instantly know").
 *  OUT = e-money left the wallet for the distributor, which spends the owner's money too; IN = the distributor topped the
 *  wallet up, which raises the B2B float. Seen in an SMS, or only in the wallet's statement (bKash sends no SMS for B2B in). */
export function b2bMessage(p: {
  direction: "in" | "out"; provider: string; amount: number; phone: string; how: "sms" | "statement";
  balance?: number | null; trxId?: string | null; day?: string | null; dashboardUrl: string;
}): string {
  const wallet = PROVIDER[p.provider] ?? clean(p.provider, 20);
  const who = clean(p.phone) || "a phone";
  const head = p.direction === "out" ? `\u{1F534} B2B OUT: ${taka(p.amount)} left ${who}'s ${wallet} wallet` : `\u{1F535} B2B in: ${taka(p.amount)} came into ${who}'s ${wallet} wallet`;
  const lines = [head];
  if (p.direction === "out") lines.push("That is money sent to the distributor. If you did not ask for it, check this wallet now.");
  else lines.push("The B2B float of this wallet went up by that amount; jobs start from the balance minus the float.");
  if (p.how === "sms") lines.push(`From the SMS${p.trxId ? ` · TrxID ${clean(p.trxId, 30)}` : ""}${p.balance != null ? ` · balance now ${taka(p.balance)}` : ""}.`);
  else lines.push(`Seen in the wallet's own statement${p.day ? ` (entry dated ${clean(p.day, 12)})` : ""}; no SMS came for it.`);
  lines.push(`${p.dashboardUrl}/#/ledger`);
  return lines.join("\n");
}

/** A balance gap PayTrace could not ask the wallet about (migration 063): the next SMS printed a balance that moved
 *  more than it explains, and no statement pull could be started, so the owner has to settle it on the Phones page. */
export function gapMessage(p: { provider: string; amount: number; phone: string; balance: number | null; why: string; dashboardUrl: string }): string {
  const wallet = PROVIDER[p.provider] ?? clean(p.provider, 20);
  const who = clean(p.phone) || "a phone";
  const inn = p.amount > 0;
  const lines = [
    inn ? `\u{1F7E1} ${taka(p.amount)} came into ${who}'s ${wallet} wallet with no SMS` : `\u{1F7E1} ${taka(-p.amount)} left ${who}'s ${wallet} wallet with no SMS`,
    inn ? "Probably B2B from the distributor. It is held back from \"your money\" until it is explained." : "Probably a cash-in or B2B the agent made.",
    `PayTrace could not ask the wallet's statement: ${clean(p.why, 80) || "unknown reason"}.`,
  ];
  if (p.balance != null) lines.push(`Balance now ${taka(p.balance)}.`);
  lines.push(`Mark what it was on the Phones page: ${p.dashboardUrl}/#/devices`);
  return lines.join("\n");
}

export const testMessage = () =>
  [
    "✅ PayTrace test message",
    "Alerts are working. You will be messaged here when a payment is held for review, a phone goes quiet, or a phone cannot capture payments.",
  ].join("\n");
