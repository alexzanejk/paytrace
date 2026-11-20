// PayTrace Telegram bot (step 2, owner 2026-11-20): receives every message of the owner's payment group, keeps who posted
// what as a CLAIM (migration 112), answers in the group when something needs the poster, and serves the OCR worker on
// the owner's VPS. Nothing here moves money.
//
// Who may call what:
//   Telegram itself     POST with header X-Telegram-Bot-Api-Secret-Token = a secret derived from the bot token at setup
//                       (one update per call; always answered 200 so Telegram does not retry forever)
//   the dashboard admin POST {"action":"setup"} registers the webhook; {"action":"status"} reads it; GET ?photo=<claim>
//                       streams a claim's photo (the bot token stays here, never in the browser)
//   the OCR worker      the SERVICE key as bearer: POST {"action":"ocr_next"}, {"action":"ocr_done"}, GET ?photo=<claim>
// verify_jwt=false: each path checks its own caller.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { corsHeaders } from "./cors.ts";
import { replyFor, type ClaimStatus, type ReplyMode } from "./wording.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const BOT_TOKEN = (Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "").trim();
const DASHBOARD_URL = (Deno.env.get("DASHBOARD_URL") ?? "https://paytrace.ashkawser54.workers.dev").replace(/\/+$/, "");
const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/telegram`;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

/** The webhook secret Telegram sends back with every update: derived from the bot token, so no second secret exists. */
const webhookSecret = async () => (await sha256hex(BOT_TOKEN + ":paytrace-telegram-webhook")).slice(0, 48);

/** The caller holds the service key (the OCR worker, or PayTrace's own functions). */
function isOurs(req: Request): boolean {
  const h = (req.headers.get("authorization") ?? "").trim();
  if (!h.toLowerCase().startsWith("bearer ") || !SERVICE_KEY) return false;
  return safeEqual(h.slice(7).trim(), SERVICE_KEY);
}

/** The signed-in dashboard admin (the database's own is_admin(), two-step rule included). */
async function isAdmin(req: Request): Promise<boolean> {
  const jwt = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!jwt || !ANON_KEY) return false;
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });
  const { data, error } = await asUser.rpc("is_admin");
  return !error && data === true;
}

// ---------- Telegram API ----------
async function tg(method: string, body: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; description?: string }> {
  if (!BOT_TOKEN) return { ok: false, description: "no bot token" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
    });
    return await res.json();
  } catch {
    // Never log the error: a fetch failure message can carry the token in the address.
    return { ok: false, description: "request failed" };
  }
}

async function reply(chatId: number, messageId: number, text: string): Promise<boolean> {
  const r = await tg("sendMessage", { chat_id: chatId, text: text.slice(0, 1000), reply_parameters: { message_id: messageId, allow_sending_without_reply: true }, disable_notification: true });
  return r.ok;
}

// ---------- claims ----------
interface Brief {
  id: string; status: ClaimStatus; kind: "photo" | "text"; ocr_status: "none" | "pending" | "done" | "failed";
  chat_id: number; message_id: number; kept?: boolean; again?: boolean;
  payment?: { trx_id?: string; amount?: number | string } | null;
}

async function replyMode(): Promise<ReplyMode> {
  const { data } = await db.from("telegram_settings").select("reply_mode").eq("id", true).maybeSingle();
  const m = data?.reply_mode;
  return m === "off" || m === "all" ? m : "problems";
}

/** Answers in the group when the claim's state asks for it, once per message. */
async function maybeReply(b: Brief | null): Promise<void> {
  try {
    if (!b || !b.kept || b.again || !b.chat_id || !b.message_id) return;
    const r = replyFor({ status: b.status, kind: b.kind, ocrStatus: b.ocr_status, trx: b.payment?.trx_id ?? null, amount: b.payment?.amount == null ? null : Number(b.payment.amount), mode: await replyMode() });
    if (!r) return;
    const { data: row } = await db.from("telegram_claims").select("replied_at").eq("id", b.id).maybeSingle();
    if (row?.replied_at) return;
    if (await reply(b.chat_id, b.message_id, r.text)) await db.rpc("tg_claim_replied", { p_claim: b.id, p_kind: r.kind });
  } catch (e) {
    console.error("reply failed", e instanceof Error ? e.name : "error");
  }
}

interface TgUser { id: number; is_bot?: boolean; username?: string; first_name?: string; last_name?: string }
interface TgPhoto { file_id: string; file_unique_id: string; width: number; height: number; file_size?: number }
interface TgMessage {
  message_id: number; date: number; media_group_id?: string;
  chat: { id: number; title?: string; type?: string; username?: string };
  from?: TgUser; text?: string; caption?: string; photo?: TgPhoto[];
  document?: { file_id: string; file_unique_id: string; mime_type?: string };
}

/** One update from Telegram: the message becomes a claim (or is only counted for its chat). */
async function onUpdate(update: { message?: TgMessage; channel_post?: TgMessage }): Promise<void> {
  const m = update.message ?? update.channel_post;
  if (!m || !m.chat || m.from?.is_bot) return;
  const from = m.from ?? { id: 0 };
  let kind = "other", fileId: string | null = null, fileUnique: string | null = null;
  const text = (m.text ?? m.caption ?? "").slice(0, 1000);
  if (m.photo && m.photo.length) {
    const best = [...m.photo].sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
    kind = "photo"; fileId = best.file_id; fileUnique = best.file_unique_id;
  } else if (m.document && (m.document.mime_type ?? "").startsWith("image/")) {
    kind = "photo"; fileId = m.document.file_id; fileUnique = m.document.file_unique_id;
  } else if (m.text) {
    kind = "text";
  }
  const name = [from.first_name, from.last_name].filter(Boolean).join(" ").slice(0, 120);
  const { data, error } = await db.rpc("tg_claim_add", {
    p_chat_id: m.chat.id, p_chat_title: m.chat.title ?? m.chat.username ?? "", p_chat_kind: m.chat.type ?? "",
    p_message_id: m.message_id, p_media_group: m.media_group_id ?? null,
    p_user_id: from.id, p_username: from.username ?? null, p_name: name || null,
    p_kind: kind, p_file_id: fileId, p_file_unique_id: fileUnique, p_text: text || null,
    p_sent_at: new Date((m.date || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
  });
  if (error) { console.error("tg_claim_add failed", error.code); return; }
  await maybeReply(data as Brief | null);
}

// ---------- the photo, for the worker and for the dashboard ----------
async function photo(claimId: string): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(claimId)) return json({ success: false, message: "bad claim" }, 400);
  const { data: c } = await db.from("telegram_claims").select("file_id").eq("id", claimId).maybeSingle();
  if (!c?.file_id) return json({ success: false, message: "no photo" }, 404);
  const f = await tg("getFile", { file_id: c.file_id });
  const path = (f.result as { file_path?: string } | undefined)?.file_path;
  if (!f.ok || !path) return json({ success: false, message: "telegram did not give the file" }, 502);
  const res = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${path}`, { signal: AbortSignal.timeout(20000) }).catch(() => null);
  if (!res || !res.ok) return json({ success: false, message: "could not download the photo" }, 502);
  const type = res.headers.get("content-type") ?? "image/jpeg";
  return new Response(res.body, { status: 200, headers: { "content-type": type, "cache-control": "private, max-age=300" } });
}

// ---------- admin: connect and status ----------
async function setup(): Promise<Response> {
  if (!BOT_TOKEN) return json({ success: false, message: "The bot token (TELEGRAM_BOT_TOKEN) is not set in Supabase." }, 400);
  const me = await tg("getMe", {});
  const username = (me.result as { username?: string } | undefined)?.username ?? null;
  if (!me.ok || !username) return json({ success: false, message: "Telegram did not accept the bot token: " + (me.description ?? "") }, 502);
  const hook = await tg("setWebhook", { url: WEBHOOK_URL, secret_token: await webhookSecret(), allowed_updates: ["message", "channel_post"], max_connections: 10 });
  if (!hook.ok) return json({ success: false, message: "setWebhook refused: " + (hook.description ?? "") }, 502);
  await db.rpc("tg_webhook_set", { p_bot_username: username });
  return json({ success: true, bot: username, webhook: WEBHOOK_URL });
}

async function status(): Promise<Response> {
  if (!BOT_TOKEN) return json({ success: true, configured: false });
  const me = await tg("getMe", {});
  const info = await tg("getWebhookInfo", {});
  const w = (info.result ?? {}) as { url?: string; pending_update_count?: number; last_error_message?: string; last_error_date?: number };
  return json({
    success: true, configured: true, bot: (me.result as { username?: string } | undefined)?.username ?? null,
    webhook_ok: w.url === WEBHOOK_URL, pending: w.pending_update_count ?? 0,
    last_error: w.last_error_message ?? null, last_error_at: w.last_error_date ? new Date(w.last_error_date * 1000).toISOString() : null,
  });
}

// ---------- the OCR worker ----------
async function ocrNext(limit: unknown): Promise<Response> {
  const { data, error } = await db.rpc("tg_ocr_next", { p_limit: Math.max(1, Math.min(20, Number(limit) || 5)) });
  if (error) return json({ success: false, message: "could not read the queue" }, 500);
  return json({ success: true, claims: data ?? [] });
}

async function ocrDone(body: Record<string, unknown>): Promise<Response> {
  const id = String(body.claim_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ success: false, message: "bad claim" }, 400);
  const text = typeof body.text === "string" ? body.text.slice(0, 4000) : "";
  const { data, error } = await db.rpc("tg_ocr_done", { p_claim: id, p_text: text, p_ok: body.ok === true });
  if (error) return json({ success: false, message: "could not save the read" }, 500);
  const b = { ...(data as Brief), kept: true } as Brief;
  await maybeReply(b);
  return json({ success: true, claim: data });
}

// ---------- routing ----------
async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const claim = url.searchParams.get("photo");
    if (!claim) return json({ success: true, message: "PayTrace Telegram bot" });
    if (!(isOurs(req) || await isAdmin(req))) return json({ success: false, message: "not allowed" }, 401);
    return await photo(claim);
  }
  if (req.method !== "POST") return json({ success: false, message: "method not allowed" }, 405);
  let body: Record<string, unknown> = {};
  try {
    const text = await req.text();
    if (text.length > 200000) return json({ success: false, message: "payload too large" }, 413);
    body = JSON.parse(text || "{}");
  } catch {
    return json({ success: false, message: "invalid JSON" }, 400);
  }
  // Telegram's own call carries the secret header and never an action.
  const given = req.headers.get("x-telegram-bot-api-secret-token");
  if (given !== null) {
    if (!BOT_TOKEN || !safeEqual(given, await webhookSecret())) return json({ success: false, message: "wrong secret" }, 403);
    try { await onUpdate(body as { message?: TgMessage }); } catch (e) { console.error("update failed", e instanceof Error ? e.name : "error"); }
    return json({ ok: true });
  }
  const action = String(body.action ?? "");
  if (action === "ocr_next" || action === "ocr_done") {
    if (!isOurs(req)) return json({ success: false, message: "not allowed" }, 401);
    return action === "ocr_next" ? await ocrNext(body.limit) : await ocrDone(body);
  }
  if (action === "setup" || action === "status") {
    if (!(await isAdmin(req))) return json({ success: false, message: "admins only" }, 401);
    return action === "setup" ? await setup() : await status();
  }
  return json({ success: false, message: "unknown action" }, 404);
}

const DASHBOARD_ORIGIN = new URL(DASHBOARD_URL).origin;
const LEGACY_DASHBOARD_ORIGIN = "https://paytrace.ashkawser54.workers.dev";

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"), [DASHBOARD_ORIGIN, LEGACY_DASHBOARD_ORIGIN]);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const res = await handle(req);
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  return res;
});
