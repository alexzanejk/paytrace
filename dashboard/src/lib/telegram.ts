// Telegram claims (step 2, 2026-11-20): the pure parts of the dashboard page. A CLAIM is one message in the owner's
// Telegram group (a payment screenshot or a text) tied to the stored transaction it names, if any. Nothing here moves
// money; paying a person out is the Payout page's job (step 4). Tested in tests/telegram.test.ts.

export type ClaimStatus = "new" | "unmatched" | "matched" | "held" | "duplicate" | "conflict" | "review" | "ignored";
export type ReplyMode = "off" | "problems" | "all";

export interface ClaimPayment {
  id: string; trx_id: string; provider: string; amount: number | string; status: string; review_reason: string | null;
  counterparty: string | null; occurred_at: string | null; phone: string | null; paid_out: boolean;
}

export interface Claim {
  id: string;
  status: ClaimStatus;
  kind: "photo" | "text";
  note: string | null;
  candidates: string[];
  ocr_status: "none" | "pending" | "done" | "failed";
  tg_user_id: number;
  username: string | null;
  name: string | null;
  chat_id: number;
  message_id: number;
  sent_at: string;
  payment: ClaimPayment | null;
  first_claim: { id: string; tg_user_id: number; username: string | null; name: string | null; sent_at: string } | null;
}

export interface UserSummary {
  tg_user_id: number; username: string | null; name: string | null; site_username: string | null; last_number: string | null;
  matched: number; matched_total: number | string; held: number; open: number; conflicts: number; last_at: string;
}

export interface TelegramSettings {
  group_chat_id: number | null; group_title: string | null; reply_mode: ReplyMode; webhook_set_at: string | null; bot_username: string | null;
}
export interface TelegramChat { chat_id: number; title: string | null; kind: string | null; last_seen_at: string; messages: number }

/** Plain words for each claim state, in the order the page lists them. */
export const STATUS_WORDS: Record<ClaimStatus, { label: string; tone: "ok" | "warn" | "bad" | "muted"; meaning: string }> = {
  matched: { label: "Matched", tone: "ok", meaning: "The TrxID is one of our counted transactions. Ready for a payout once you decide." },
  held: { label: "Held", tone: "warn", meaning: "The transaction exists but is held for review in PayTrace. It follows by itself when released." },
  new: { label: "Reading", tone: "muted", meaning: "A photo the OCR worker has not read yet." },
  unmatched: { label: "No match", tone: "warn", meaning: "No TrxID of ours in this message. Pick the transaction by hand, or ignore it." },
  review: { label: "Look", tone: "warn", meaning: "The read fits more than one transaction, or the transaction is one we do not count." },
  duplicate: { label: "Duplicate", tone: "muted", meaning: "The same person already submitted this TrxID." },
  conflict: { label: "Conflict", tone: "bad", meaning: "Another person submitted this TrxID first. Decide who it belongs to." },
  ignored: { label: "Ignored", tone: "muted", meaning: "You dismissed it." },
};
export const STATUS_ORDER: ClaimStatus[] = ["conflict", "review", "unmatched", "held", "matched", "new", "duplicate", "ignored"];

export const REPLY_MODES: Array<{ id: ReplyMode; label: string; meaning: string }> = [
  { id: "off", label: "Never", meaning: "The bot writes nothing in the group." },
  { id: "problems", label: "Only when needed", meaning: "TrxID could not be read, transaction held, or already submitted." },
  { id: "all", label: "Every message", meaning: "Also a short \"received\" on every match." },
];

/** "Alice (@alice)", "Alice", "@alice" or "user 7001". Never trusts the names for identity: the id is the key. */
export function userLabel(u: { username?: string | null; name?: string | null; tg_user_id: number }): string {
  const name = (u.name ?? "").trim();
  const handle = (u.username ?? "").trim();
  if (name && handle) return `${name} (@${handle})`;
  if (name) return name;
  if (handle) return `@${handle}`;
  return `user ${u.tg_user_id}`;
}

export const taka = (n: number | string) => "Tk " + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const WALLET: Record<string, string> = { bkash: "bKash", nagad: "Nagad", rocket: "Rocket", upay: "Upay" };
export const walletName = (p: string) => WALLET[p] ?? p;

/** One line for the transaction a claim points at. */
export function paymentLine(p: ClaimPayment | null): string {
  if (!p) return "no transaction";
  return `${walletName(p.provider)} ${taka(p.amount)} · TrxID ${p.trx_id}${p.phone ? ` · ${p.phone}` : ""}${p.paid_out ? " · already in a payout" : ""}`;
}

/** What the row says under the status: the note, or what was read. */
export function claimDetail(c: Claim): string {
  if (c.status === "duplicate" || c.status === "conflict") {
    const who = c.first_claim ? userLabel(c.first_claim) : "someone";
    return c.status === "duplicate" ? `same person, earlier message` : `first submitted by ${who}`;
  }
  if (c.status === "new") return c.kind === "photo" ? "waiting for the OCR worker" : "";
  if (c.note) return c.note;
  if (c.candidates.length) return `read: ${c.candidates.join(", ")}`;
  return "";
}

export function statusCounts(claims: Claim[]): Record<ClaimStatus, number> {
  const out = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<ClaimStatus, number>;
  for (const c of claims) out[c.status]++;
  return out;
}

/** How many need the owner now: conflicts, looks and no-matches. */
export const needsOwner = (counts: Record<ClaimStatus, number>) => counts.conflict + counts.review + counts.unmatched;

/** Where the bot stands, from the settings and the function's status answer, in one phrase and a next step. */
export function connectState(s: TelegramSettings | null, status: { configured?: boolean; webhook_ok?: boolean; bot?: string | null } | null): { state: "no_token" | "not_connected" | "no_group" | "ready" | "unknown"; line: string; next: string } {
  if (status && status.configured === false) return { state: "no_token", line: "The bot token is not set in Supabase.", next: "Set TELEGRAM_BOT_TOKEN (the alert bot's token) as an Edge Function secret, then press Connect." };
  if (status && status.webhook_ok === false) return { state: "not_connected", line: `The bot${status.bot ? ` @${status.bot}` : ""} is not receiving the group yet.`, next: "Press Connect the bot, then add the bot to the group as an admin." };
  if (!s?.group_chat_id) return { state: "no_group", line: "Connected, but no group is chosen.", next: "Post one message in the group, then pick it below." };
  if (!status) return { state: "unknown", line: `Group: ${s.group_title ?? s.group_chat_id}.`, next: "" };
  return { state: "ready", line: `Receiving ${s.group_title ?? "the group"}${status.bot ? ` as @${status.bot}` : ""}.`, next: "" };
}

/** The period choices of the page, as [from, to). */
export function periodRange(id: "today" | "7d" | "30d", now = new Date()): { from: Date; to: Date } {
  const to = new Date(now.getTime() + 60_000);
  const days = id === "today" ? 1 : id === "7d" ? 7 : 30;
  // "Today" = since midnight Dhaka, like the rest of the dashboard.
  if (id === "today") {
    const dhaka = new Date(now.getTime() + 6 * 3600_000);
    const start = Date.UTC(dhaka.getUTCFullYear(), dhaka.getUTCMonth(), dhaka.getUTCDate()) - 6 * 3600_000;
    return { from: new Date(start), to };
  }
  return { from: new Date(now.getTime() - days * 86_400_000), to };
}

/** A TrxID typed by the owner into "Pick transaction": letters and digits only, upper case. */
export function cleanTrx(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 24);
}
