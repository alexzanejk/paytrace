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
  ["unsupported_type", "this kind of message cannot credit an order"],
  ["unrecognized_type", "could not tell what kind of payment this is"],
  ["unverified_format", "the message format is not confirmed yet"],
  ["balance_chain_mismatch", "the account balance does not follow the previous message, so it could be a fake SMS"],
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

export function silentMessage(p: { name: string; code: string; minutes: number; dashboardUrl: string }): string {
  return [
    "📵 A phone has gone quiet",
    `${clean(p.name) || "Unnamed phone"} (code ${clean(p.code, 12)}) has not been heard from for ${duration(p.minutes)}.`,
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

export const testMessage = () =>
  [
    "✅ PayTrace test message",
    "Alerts are working. You will be messaged here when a payment is held for review, a phone goes quiet, or a phone cannot capture payments.",
  ].join("\n");
