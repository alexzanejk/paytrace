// Telegram claims (step 2, 2026-11-20): the pure parts of the dashboard page. A CLAIM is one message in the owner's
// Telegram group (a payment screenshot or a text) tied to the stored transaction it names, if any. Nothing here moves
// money; paying a person out is the Payout page's job (step 4). Tested in tests/telegram.test.ts.

export type ClaimStatus = "new" | "unmatched" | "matched" | "paid" | "held" | "duplicate" | "conflict" | "review" | "ignored";
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
  site_username?: string | null;      // the site login this person typed in the group (kept, never used for the name: owner 2026-11-20)
  site_username_seen?: string | null; // the one typed in THIS message
  reacted?: boolean;                   // the bot's reaction is on the post (👍 on a match; 👎 on a conflict since migration 124)
  react_pending?: boolean;
  react_kind?: "up" | "down";          // which thumb the bot put (or will put) on the post; absent = up (older rows)
  warned?: boolean;                    // migration 124: the bot replied under this conflicting post, naming the first poster and asking to delete it
  warn_pending?: boolean;
  warn_swapped?: boolean;              // the warning says the transaction was confirmed for someone else (after the owner's decision)
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
  payout_reply?: boolean | null; // step 5: tell the person in the group when their payout is paid (default on)
  owner_chat_id?: number | null; // migration 121: the owner's own chat with the bot, paired by a one-time code
  owner_user_id?: number | null;
  owner_set_at?: string | null;
  owner_copy?: boolean | null;   // a copy of every private notice goes to that chat (default on once paired)
  payout_group_fallback?: boolean | null; // migration 122: reply in the group when the person has no private chat (default OFF: private only)
  conflict_warn?: boolean | null; // migration 124: 👎 + a warning under a post whose TrxID another person posted first (default ON)
}

/** The bot's mark on a post, for the claim row and the person's History: 👍 on a match, 👎 on a conflict (migration 124), or none.
 *  Words only; the reaction itself is sent by the bot. */
export function reactionMark(c: Pick<Claim, "reacted" | "react_kind" | "warned" | "warn_swapped" | "react_pending" | "warn_pending">): { emoji: "👍" | "👎"; title: string } | null {
  const down = c.react_kind === "down";
  if (c.reacted) {
    if (!down) return { emoji: "👍", title: "The bot put a thumbs-up on this post" };
    const warned = c.warned
      ? c.warn_swapped ? ", and replied that the transaction was confirmed for someone else" : ", and replied naming the person who posted it first and asking to delete the post"
      : "";
    return { emoji: "👎", title: `The bot put a thumbs-down on this post${warned}` };
  }
  if (c.react_pending) return { emoji: down ? "👎" : "👍", title: "The bot will react to this post within the minute" };
  return null;
}

export const CONFLICT_WARN_WORDS = {
  label: "Warn the second person on a conflict",
  meaning: "When a TrxID another person already posted is posted again by someone else, the bot puts a 👎 on the later post and replies under it, naming who posted it first and asking them to delete the post if it is not theirs. The same person posting twice gets nothing. Ignore on the first person's claim hands the transaction to the second person: the thumbs swap and the warning moves.",
  on: "On: a later post of someone else's TrxID gets a 👎 and a warning naming the first poster.",
  off: "Off: a conflict gets no reaction and no reply; it only waits for you on this page.",
} as const;
/** Whether the bot may write to a person privately (migration 119): Telegram allows it only after the person wrote to
 *  the bot first (pressed Start), and a refusal (blocked, never started) is remembered until they write again. */
export interface TelegramUserDm { tg_user_id: number; dm_since: string | null; dm_blocked_at: string | null; dm_blocked_why?: string | null; username?: string | null }
export type DmState = "private" | "blocked" | "group_only";
export function dmState(u: Pick<TelegramUserDm, "dm_since" | "dm_blocked_at"> | null | undefined): DmState {
  if (!u || !u.dm_since) return "group_only";
  return u.dm_blocked_at ? "blocked" : "private";
}
export const DM_WORDS: Record<DmState, { label: string; meaning: string; tone: "ok" | "warn" | "idle" }> = {
  private: { label: "private inbox ✓", meaning: "This person has opened the bot, so payout notices go to their private chat (with the full number).", tone: "ok" },
  blocked: { label: "blocked the bot", meaning: "Telegram refused the private chat (the person blocked the bot or removed it); they get no notice until they write to the bot again (you are told each time).", tone: "warn" },
  group_only: { label: "no private chat", meaning: "This person has not opened the bot yet. Notices are private only, so they get none until they press Start (you are told each time). Pin the invitation.", tone: "idle" },
};
export const dmById = (rows: TelegramUserDm[] | null | undefined) => new Map((rows ?? []).map((r) => [r.tg_user_id, r] as const));

/** The message the owner pins in the group so people open the bot and get their payout notices privately. */
export function inviteText(botUsername: string | null | undefined): string {
  const bot = botUsername ? "@" + botUsername.replace(/^@/, "") : "our bot";
  return `📩 পেমেন্টের খবর ব্যক্তিগতভাবে পেতে ${bot} খুলে Start চাপুন (একবারই)। এরপর আপনার পেমেন্ট পাঠানো হলে বটটি আপনাকে সরাসরি মেসেজ দেবে, নম্বরসহ।
`
    + `To get your payment notices privately, open ${bot} and press Start once. After that the bot messages you directly, with the number, each time your payment is sent.`;
}

export interface TelegramChat { chat_id: number; title: string | null; kind: string | null; last_seen_at: string; messages: number }

/** Plain words for each claim state, in the order the page lists them. */
export const STATUS_WORDS: Record<ClaimStatus, { label: string; tone: "ok" | "warn" | "bad" | "muted"; meaning: string }> = {
  matched: { label: "Matched", tone: "ok", meaning: "The TrxID is one of our counted transactions, not paid out yet. The bot put a thumbs-up on the post." },
  paid: { label: "Paid out", tone: "muted", meaning: "The transaction is already in a payout. No reaction, nothing to do." },
  held: { label: "Held", tone: "warn", meaning: "The transaction exists but is held for review in PayTrace. It follows by itself when released." },
  new: { label: "Reading", tone: "muted", meaning: "A photo the OCR worker has not read yet." },
  unmatched: { label: "No match", tone: "warn", meaning: "No TrxID of ours in this message. Pick the transaction by hand, or ignore it." },
  review: { label: "Look", tone: "warn", meaning: "The read fits more than one transaction, or the transaction is one we do not count." },
  duplicate: { label: "Duplicate", tone: "muted", meaning: "The same person already submitted this TrxID." },
  conflict: { label: "Conflict", tone: "bad", meaning: "Another person submitted this TrxID first. Decide who it belongs to." },
  ignored: { label: "Ignored", tone: "muted", meaning: "You dismissed it." },
};
export const STATUS_ORDER: ClaimStatus[] = ["conflict", "review", "unmatched", "held", "matched", "paid", "new", "duplicate", "ignored"];

/** TEXT replies. The thumbs-up reaction on a matched post is always on and is not a reply. */
export const REPLY_MODES: Array<{ id: ReplyMode; label: string; meaning: string }> = [
  { id: "off", label: "Never (only the thumbs-up)", meaning: "The bot writes no text; a matched post gets a thumbs-up, anything else gets nothing." },
  { id: "problems", label: "Only when needed", meaning: "TrxID could not be read, transaction held, or already submitted." },
  { id: "all", label: "Every message", meaning: "Also a short \"received\" on every match." },
];

/** The name the owner pays under (owner 2026-11-20: "only telegram user name"): the @username; the site login a person
 *  types in a post is never used for it. */
export function personLabel(u: { username?: string | null; name?: string | null; tg_user_id: number }): string {
  return userLabel(u);
}

/** "@alice", "Alice" (no username) or "user 7001". The @username comes first because display names are not unique
 *  (owner 2026-11-20); the display name is shown only for a person with no username. Never trusts the names for
 *  identity: the id is the key. */
export function userLabel(u: { username?: string | null; name?: string | null; tg_user_id: number }): string {
  const name = (u.name ?? "").trim();
  const handle = (u.username ?? "").trim();
  if (handle) return `@${handle}`;
  if (name) return name;
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

/** Does this claim need the owner's eyes? Conflicts and "look at this" always; a no-match only when it was a real
 *  attempt (a photo, or a text that carried a TrxID-shaped word). Plain chat in the group (a text with nothing
 *  TrxID-shaped in it) is kept under "No match" and "All" but never counted as needing anyone (owner 2026-11-20:
 *  12 of 14 "Needs you" were greetings and "please check"). */
export const needsYou = (c: Pick<Claim, "status" | "kind" | "candidates">) =>
  c.status === "conflict" || c.status === "review" || (c.status === "unmatched" && (c.kind === "photo" || c.candidates.length > 0));

/** How many need the owner now. */
export const needsOwner = (claims: Array<Pick<Claim, "status" | "kind" | "candidates">>) => claims.filter(needsYou).length;

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

/** Copies of private notices to the owner (migration 121): not paired yet, paired and on, or paired and switched off. */
export type OwnerState = "unset" | "on" | "off";
export function ownerState(s: Pick<TelegramSettings, "owner_chat_id" | "owner_copy"> | null | undefined): OwnerState {
  if (!s || !s.owner_chat_id) return "unset";
  return s.owner_copy === false ? "off" : "on";
}
/** What the owner sends the bot to pair their chat. The code is shown once and dies after 10 minutes. */
export function ownerCommand(code: string): string {
  return "/owner " + String(code).replace(/\D/g, "").slice(0, 6);
}
export const OWNER_WORDS: Record<OwnerState, string> = {
  unset: "Not set up. Get a code, send it to the bot from your own Telegram, and every private notice is copied to you.",
  on: "On: every private payout notice is also sent to your own chat with the bot, word for word, with the person's name on top.",
  off: "Paired, but copies are switched off.",
};
