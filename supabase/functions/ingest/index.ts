// PayTrace ingest endpoint: receives SMS data from the Android app.
// Auth, either:
//   `Authorization: Device <key>`  a phone's own key, approved by an admin in the dashboard (normal case), or
//   `Authorization: <INGEST_SECRET>` (or "Bearer <secret>")  the shared secret (older setup, still accepted).
// Pairing: POST {"action":"pair","token_hash":<sha256 hex of key>,"name":...} needs no auth; it only creates a
// pending request that an admin must approve. Supports POST (JSON) and GET (query string).
// Heartbeat: {"action":"heartbeat",...} from an approved phone every 30 seconds; proves it is alive.
// Test alert: {"action":"test_alert"} with the dashboard admin's own login token sends one Telegram message,
// so the owner can confirm alerts are set up. Admins only (checked with the database's own is_admin()).
// Watchdog: {"action":"watchdog"} is called by the database's scheduler (pg_cron) every minute. It needs no
// auth because it returns nothing and only acts when real timestamps say a phone has gone offline; each phone is
// alerted once, so calling it repeatedly cannot cause a flood.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { parseSms, senderMatchesProvider, type Provider } from "./parser.ts";
import { cleanInfo, healthProblem, type DeviceInfo } from "./health.ts";
import { b2bMessage, confirmedMessage, gapMessage, makeNotifier, notConfirmedMessage, notInAppMessage, problemMessage, recoveredMessage, reviewMessage, testMessage, unreadMessage } from "./notify.ts";
import { readStatementLines } from "./statement.ts";
import { runWatchdog } from "./watchdog.ts";
import { runWake } from "./wake.ts";
import { makePusher } from "./fcm.ts";
import { corsHeaders } from "./cors.ts";

// Supabase's runtime lets work finish after the response is sent. Absent when run elsewhere (tests).
// How each kind of outgoing money is labelled in payments.review_reason (shown on the dashboard, counted by device_day_flows).
const OUT_REASON: Record<string, string> = { b2b: "b2b_transfer_out", cash_in: "cash_in_sent", cash_out: "cash_out_sent", payment: "payment_sent", bill: "bill_paid", loan: "loan_repaid", send_money: "send_money_sent" };

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;
const defer = (p: Promise<unknown>) => {
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(p);
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const INGEST_SECRET = Deno.env.get("INGEST_SECRET") ?? "";
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
// The gateway lets our own calls to /deliver through at once; anyone without the service key is slowed to one run per 2 s (migration 056).
const DELIVER_AUTH = { authorization: `Bearer ${SERVICE_KEY}` };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Short code shown on the phone and in the dashboard, so the admin approves the right phone. */
const pairCode = (hash: string) => hash.slice(0, 4).toUpperCase() + "-" + hash.slice(4, 8).toUpperCase();

const MAX_PENDING_PER_HOUR = 10;

// Telegram alerts. Both secrets are set by the owner in Supabase (Edge Functions -> Secrets).
// Without them everything still works; the owner just is not messaged.
const notify = makeNotifier({
  token: Deno.env.get("TELEGRAM_BOT_TOKEN"),
  chatId: Deno.env.get("TELEGRAM_CHAT_ID"),
});
// Wake-up pushes through Firebase. The service account key is a secret the owner sets in Supabase; without it
// nothing is sent and everything else works as before.
const pusher = makePusher(Deno.env.get("FIREBASE_SERVICE_ACCOUNT"));
const DASHBOARD_URL = (Deno.env.get("DASHBOARD_URL") ?? "https://paytrace.ashkawser54.workers.dev").replace(/\/+$/, "");

// The owner is told on Telegram when a phone has been offline this long. The dashboard shows "Offline" sooner
// (after 90 seconds); the wait here keeps a brief network blip from sending a message. Keep in step with
// ALERT_AFTER_MIN in dashboard/src/lib/deviceHealth.ts.
const ALERT_AFTER_MIN = 3;

async function log(kind: string, provider: string | null, detail: Record<string, unknown>, paymentId?: string) {
  await db.from("events").insert({ kind, provider, payment_id: paymentId ?? null, detail });
}

/** Alerts once for each approved phone that has gone quiet. Called by pg_cron. */
async function watchdog(): Promise<Response> {
  await runWatchdog(
    {
      async candidates() {
        const { data } = await db
          .from("devices")
          .select("id,name,pair_code,last_seen_at,approved_at")
          .eq("status", "approved")
          .is("silent_alerted_at", null);
        return data ?? [];
      },
      async claim(id) {
        const { data } = await db
          .from("devices")
          .update({ silent_alerted_at: new Date().toISOString() })
          .eq("id", id)
          .is("silent_alerted_at", null)
          .select("id");
        return !!data?.length;
      },
      async release(id) {
        await db.from("devices").update({ silent_alerted_at: null }).eq("id", id);
      },
      record: (kind, detail) => log(kind, null, detail),
    },
    notify,
    { now: Date.now(), alertAfterMin: ALERT_AFTER_MIN, dashboardUrl: DASHBOARD_URL },
  );
  // Phones that have gone quiet get a wake-up push, so Android starts PayTrace again.
  await runWake(
    {
      async candidates() {
        const { data: devs } = await db
          .from("devices").select("id,name,last_seen_at,approved_at").eq("status", "approved");
        const { data: toks } = await db.from("device_push").select("device_id,token,woken_at,wake_tries,visible_at");
        const byId = new Map((toks ?? []).map((t) => [t.device_id as string, t]));
        return (devs ?? []).filter((d) => byId.has(d.id)).map((d) => {
          const t = byId.get(d.id)!;
          return { ...d, token: t.token as string, woken_at: t.woken_at as string | null, tries: Number(t.wake_tries) || 0, visible_at: t.visible_at as string | null };
        });
      },
      async claim(id, expectedWokenAt, next) {
        const now = new Date().toISOString();
        const change: Record<string, unknown> = { woken_at: now, wake_tries: next.tries };
        if (next.visible) change.visible_at = now;
        // Only the run that still sees the push time it read may write; an overlapping run matches no row.
        let q = db.from("device_push").update(change).eq("device_id", id);
        q = expectedWokenAt === null ? q.is("woken_at", null) : q.eq("woken_at", expectedWokenAt);
        const { data } = await q.select("device_id");
        return !!data?.length;
      },
      async forget(id) {
        await db.from("device_push").delete().eq("device_id", id);
      },
      record: (kind, detail) => log(kind, null, detail),
    },
    pusher,
    { now: Date.now() },
  );
  return json({ success: true });
}

/** Checks that the caller is the signed-in dashboard admin. Returns an error response, or null when all is well. */
async function adminCheck(authHeader: string): Promise<Response | null> {
  const jwt = authHeader.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!jwt) return json({ success: false, message: "sign in to the dashboard first" }, 401);
  if (!ANON_KEY) return json({ success: false, message: "server not configured" }, 500);
  // Ask the database itself, as this user, so the same admin and two-step rules apply as everywhere else.
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
  const { data: isAdmin, error } = await asUser.rpc("is_admin");
  if (error) return json({ success: false, message: "not signed in" }, 401);
  if (isAdmin !== true) return json({ success: false, message: "admins only" }, 403);
  return null;
}

/** Sends one Telegram message if the caller is the signed-in dashboard admin. */
async function testAlert(authHeader: string): Promise<Response> {
  const denied = await adminCheck(authHeader);
  if (denied) return denied;
  if (!notify.enabled) return json({ success: true, configured: false, sent: false });
  return json({ success: true, configured: true, sent: await notify.send(testMessage()) });
}

/** Sends one wake-up push to one phone, for the admin who clicked "Test wake-up" on the Phones page. The phone
 *  reports it back in its next heartbeat (wake_count / last_wake_at), which is how the dashboard shows it arrived. */
async function testWake(authHeader: string, deviceId: string): Promise<Response> {
  const denied = await adminCheck(authHeader);
  if (denied) return denied;
  if (!/^[0-9a-f-]{36}$/i.test(deviceId)) return json({ success: false, message: "bad device" }, 400);
  if (!pusher.enabled) return json({ success: true, configured: false });
  const { data: row } = await db.from("device_push").select("token").eq("device_id", deviceId).maybeSingle();
  if (!row) return json({ success: true, configured: true, registered: false });
  const result = await pusher.wake(row.token as string);
  if (result === "bad_token") await db.from("device_push").delete().eq("device_id", deviceId);
  await log("phone_wake_test", null, { device_id: deviceId, result });
  return json({ success: true, configured: true, registered: result !== "bad_token", result });
}

/** Nudges a phone to take a command now instead of on its next 30 s beat. Fire-and-forget: the command is saved either way. */
async function wakeDevice(deviceId: string): Promise<void> {
  try {
    if (!pusher.enabled) return;
    const { data: row } = await db.from("device_push").select("token").eq("device_id", deviceId).maybeSingle();
    if (row?.token) await pusher.wake(row.token as string);
  } catch {
    // never let a wake-up problem touch the payment path
  }
}

/** Judges the phone's answer to an automatic check and tells the owner. Nothing here credits an order: the database does,
 *  through reconcile_payment, once the wallet has vouched for the payment. */
async function judgeWalletCheck(commandId: string, ok: boolean, balance: number | null, screens: string[] | null, err: string): Promise<void> {
  try {
    const { data: chk } = await db.from("payment_checks").select("id,step,payment_id").eq("command_id", commandId).eq("status", "queued").maybeSingle();
    if (!chk) return;
    const { data: pay } = await db.from("payments").select("provider,amount,trx_id").eq("id", chk.payment_id).maybeSingle();
    let verdict: { confirmed?: boolean; result?: string; detail?: string; next?: { command_id?: string; device_id?: string; error?: string } } | null = null;
    if (chk.step === "balance") {
      const { data } = await db.rpc("payment_check_judge_balance", { p_command: commandId, p_ok: ok, p_balance: balance, p_error: ok ? null : err });
      verdict = data;
      if (verdict?.next?.command_id && verdict.next.device_id) await wakeDevice(verdict.next.device_id);
    } else {
      const lines = ok ? readStatementLines(screens) : [];
      const { data } = await db.rpc("payment_check_judge_statement", { p_command: commandId, p_ok: ok, p_lines: lines, p_error: ok ? null : err });
      verdict = data;
    }
    if (!verdict || !pay) return;
    await log("payment_check_judged", pay.provider, { payment_id: chk.payment_id, step: chk.step, confirmed: verdict.confirmed === true, detail: verdict.detail ?? null });
    if (verdict.confirmed) {
      await notify.send(confirmedMessage({ provider: pay.provider, amount: Number(pay.amount), trxId: pay.trx_id, how: chk.step, detail: verdict.detail ?? "", result: verdict.result ?? "" }));
      if (verdict.result === "matched") {
        await fetch(`${SUPABASE_URL}/functions/v1/gateway/deliver`, { method: "POST", headers: DELIVER_AUTH, body: "{}" }).then((x) => x.body?.cancel()).catch(() => {});
      }
    } else if (chk.step === "statement" || !verdict.next?.command_id) {
      // The last step did not settle it (or the next one could not start): the owner decides.
      const why = verdict.detail ?? "";
      const extra = verdict.next?.error ? ` (next step not possible: ${verdict.next.error})` : "";
      await notify.send(notConfirmedMessage({ provider: pay.provider, amount: Number(pay.amount), trxId: pay.trx_id, detail: why + extra, dashboardUrl: DASHBOARD_URL }));
    }
  } catch (e) {
    console.error("wallet check judge failed", e instanceof Error ? e.name : "error");
  }
}

/** After a bKash app read: each held payment the app listed was released, each one two reads did not list is a likely
 *  fake (migration 085, `app_read_recorded` event). Only messages; nothing here touches a payment. */
async function tellAppVerdicts(commandId: string, deviceName: string): Promise<void> {
  try {
    const { data } = await db.from("events").select("detail").eq("kind", "app_read_recorded").eq("detail->>command", commandId)
      .order("at", { ascending: false }).limit(1).maybeSingle();
    const d = (data?.detail ?? null) as {
      app_confirmed?: { provider?: string; amount?: number | string; trx_id?: string; detail?: string; result?: string }[];
      app_fake?: { amount?: number | string; trx_id?: string; detail?: string }[];
    } | null;
    let matched = false;
    for (const c of d?.app_confirmed ?? []) {
      await notify.send(confirmedMessage({ provider: c.provider ?? "bkash", amount: Number(c.amount) || 0, trxId: String(c.trx_id ?? ""), how: "bKash app", detail: String(c.detail ?? ""), result: String(c.result ?? "") }));
      if (c.result === "matched") matched = true;
    }
    for (const f of d?.app_fake ?? []) {
      await notify.send(notInAppMessage({ amount: Number(f.amount) || 0, trxId: String(f.trx_id ?? ""), phone: deviceName, detail: String(f.detail ?? ""), dashboardUrl: DASHBOARD_URL }));
    }
    if (matched) {
      await fetch(`${SUPABASE_URL}/functions/v1/gateway/deliver`, { method: "POST", headers: DELIVER_AUTH, body: "{}" }).then((x) => x.body?.cancel()).catch(() => {});
    }
  } catch (e) {
    console.error("app verdicts failed", e instanceof Error ? e.name : "error");
  }
}

/** Keeps the lines of a finished statement pull for the wallet ledger (migration 059) and tells the owner about any B2B
 *  OUT that only the statement showed. Nothing here can touch the command or the payment path. */
async function recordStatement(commandId: string, screens: string[], deviceName: string): Promise<void> {
  try {
    const lines = readStatementLines(screens);
    if (lines.length === 0) return;
    const { data, error } = await db.rpc("statement_lines_record", { p_command: commandId, p_lines: lines });
    if (error) { console.error("statement_lines_record failed", error.code); return; }
    const r = data as {
      count?: number; provider?: string; added?: { day?: string; type?: string; amount?: number | string }[];
      confirmed?: { trx_id?: string; amount?: number | string; provider?: string; result?: string; detail?: string }[];
      gaps?: { gap_id?: string; amount?: number | string; kind?: string; day?: string; line_amount?: number | string }[];
    } | null;
    // Migration 061: the pull re-judged the wallet's chain holds; tell the owner about each one it released.
    for (const c of r?.confirmed ?? []) {
      await notify.send(confirmedMessage({ provider: c.provider ?? r?.provider ?? "", amount: Number(c.amount) || 0, trxId: String(c.trx_id ?? ""), how: "statement", detail: String(c.detail ?? ""), result: String(c.result ?? "") }));
    }
    for (const a of r?.added ?? []) {
      const amount = Number(a.amount);
      if (/b2b/i.test(String(a.type ?? "")) && Number.isFinite(amount) && amount < 0) {
        await notify.send(b2bMessage({ direction: "out", provider: r?.provider ?? "", amount: -amount, phone: deviceName, how: "statement", day: a.day ?? null, dashboardUrl: DASHBOARD_URL }));
      }
    }
    // Migration 063: the pull explained balance movements no SMS had accounted for. A B2B in found this way is what
    // the owner asked to know about (rubel's bKash, 7 Nov): it now counts in the wallet's B2B float.
    for (const g of r?.gaps ?? []) {
      const amount = Number(g.line_amount ?? g.amount);
      if (g.kind === "b2b_in" && Number.isFinite(amount) && amount > 0) {
        await notify.send(b2bMessage({ direction: "in", provider: r?.provider ?? "", amount, phone: deviceName, how: "statement", day: g.day ?? null, dashboardUrl: DASHBOARD_URL }));
      }
    }
  } catch (e) {
    console.error("statement record failed", e instanceof Error ? e.name : "error");
  }
}

/** A balance that moved more than its SMS explains is a GAP (migration 063): money came in or left with no message
 *  (bKash prints nothing for a B2B in). Record it against this SMS, ask the wallet's statement at once while the entry
 *  is still among its newest, and wake the phone. Until the statement (or the owner) explains it, an unexplained IN is
 *  held back from "your money" like B2B. Nothing here can touch the payment path. */
async function recordGap(paymentId: string, deviceName: string): Promise<void> {
  try {
    const { data, error } = await db.rpc("balance_gap_record", { p_payment: paymentId });
    if (error) { console.error("balance_gap_record failed", error.code); return; }
    const r = data as { gap?: string | null; amount?: number | string; pull?: boolean; why?: string | null; device_id?: string; explained?: boolean } | null;
    if (!r?.gap) return;
    if (r.pull && r.device_id) await wakeDevice(r.device_id);
    const { data: pay } = await db.from("payments").select("provider,balance").eq("id", paymentId).maybeSingle();
    // Tell the owner only when PayTrace cannot find out by itself (no statement could be asked) and the statement had
    // not already explained it: then the Phones page is the only place it gets settled.
    if (!r.pull && !r.explained) {
      await notify.send(gapMessage({ provider: pay?.provider ?? "", amount: Number(r.amount) || 0, phone: deviceName, balance: pay?.balance == null ? null : Number(pay.balance), why: r.why ?? "", dashboardUrl: DASHBOARD_URL }));
    }
  } catch (e) {
    console.error("gap record failed", e instanceof Error ? e.name : "error");
  }
}

/** A held payment is a question for the phone (migration 053): start the balance step and wake the phone. */
async function startWalletCheck(paymentId: string): Promise<void> {
  const { data, error } = await db.rpc("payment_check_start", { p_payment: paymentId, p_step: "balance" });
  if (error) { console.error("payment_check_start failed", error.code); return; }
  const r = data as { command_id?: string; device_id?: string; error?: string } | null;
  if (r?.command_id && r.device_id) defer(wakeDevice(r.device_id));
}

/** Tells the owner that an SMS could not be read, at most once per wallet type every 6 hours (an unknown layout tends
 *  to repeat). Before this (audit 2026-11-04) such messages sat only in the log, unseen, each one a hole in the balance chain. */
async function alertUnread(provider: string | null, reason: string): Promise<void> {
  try {
    if (!notify.enabled) return;
    const since = new Date(Date.now() - 6 * 3600_000).toISOString();
    let q = db.from("events").select("id", { count: "exact", head: true }).eq("kind", "parse_failed_alerted").gte("at", since);
    q = provider ? q.eq("provider", provider) : q.is("provider", null);
    const { count } = await q;
    if ((count ?? 0) > 0) return;
    await log("parse_failed_alerted", provider, { reason });
    await notify.send(unreadMessage({ provider, reason, dashboardUrl: DASHBOARD_URL }));
  } catch {
    // an alert must never touch the message path
  }
}

/** The owner's "Run the parser again": reads logged messages that could not be read before with the parser as it is NOW.
 *  Body {"event_id": N} for one, or nothing for every unread message of the last 30 days that has not been stored since
 *  (at most 50 a call). Each goes through the same path as a live SMS (sender check, balance chain, matching); the log
 *  row gets rerun_at / rerun_result / rerun_payment_id. Admins only. */
async function reparse(authHeader: string, body: Record<string, unknown>): Promise<Response> {
  const denied = await adminCheck(authHeader);
  if (denied) return denied;
  const one = body.event_id == null ? null : Number(body.event_id);
  if (one !== null && !Number.isInteger(one)) return json({ success: false, message: "bad event_id" }, 400);
  let q = db.from("events").select("id,at,provider,detail").eq("kind", "parse_failed").order("at", { ascending: true });
  q = one !== null ? q.eq("id", one) : q.gte("at", new Date(Date.now() - 30 * 864e5).toISOString()).limit(400);
  const { data: events, error } = await q;
  if (error) return json({ success: false, message: "could not read the log" }, 500);
  const todo = (events ?? []).filter((e) => {
    const det = (e.detail ?? {}) as Record<string, unknown>;
    return one !== null || !["stored", "duplicate", "ignored"].includes(String(det.rerun_result ?? ""));
  }).slice(0, 50);
  const results: { id: number; result: string; status?: string | null }[] = [];
  for (const e of todo) {
    const det = (e.detail ?? {}) as Record<string, unknown>;
    const raw = typeof det.raw === "string" ? det.raw : "";
    const senderId = typeof det.sender_id === "string" ? det.sender_id : "";
    const dev = typeof det.device_id === "string" && /^[0-9a-f-]{36}$/i.test(det.device_id) ? det.device_id : null;
    const sim = simSlotOf(det.sim_slot);
    let result = "no_text", status: string | null = null, paymentId: string | null = null;
    if (raw) {
      const res = await storeSms({ raw, hint: (e.provider ?? "").toLowerCase(), senderId, deviceId: dev, simSlot: sim, rerun: true, legacyTrusted: !senderId });
      const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      status = typeof out.status === "string" ? out.status : null;
      paymentId = typeof out.payment_id === "string" ? out.payment_id : null;
      result = out.duplicate === true ? "duplicate" : paymentId ? "stored" : out.ignored === true ? "ignored"
        : out.parsed === false ? "still_unreadable" : res.status === 403 ? "sender_rejected" : "failed";
    }
    await db.from("events").update({ detail: { ...det, rerun_at: new Date().toISOString(), rerun_result: result, rerun_status: status, rerun_payment_id: paymentId } }).eq("id", e.id);
    results.push({ id: Number(e.id), result, status });
  }
  if (results.length) await log("parse_rerun", null, { count: results.length, stored: results.filter((r) => r.result === "stored").length, one: one !== null });
  return json({ success: true, results });
}

async function handle(req: Request): Promise<Response> {
  // ---- read payload (POST json or GET query) ----
  let body: Record<string, unknown> = {};
  try {
    if (req.method === "POST") {
      const text = await req.text();
      if (text.length > 20000) return json({ success: false, message: "payload too large" }, 413);
      body = JSON.parse(text || "{}");
    } else if (req.method === "GET") {
      body = Object.fromEntries(new URL(req.url).searchParams.entries());
    } else {
      return json({ success: false, message: "method not allowed" }, 405);
    }
  } catch {
    return json({ success: false, message: "invalid JSON" }, 400);
  }

  // ---- pairing request: no auth, creates a PENDING device that an admin must approve ----
  if (req.method === "POST" && body.action === "pair") {
    const hash = String(body.token_hash ?? "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash)) return json({ success: false, message: "bad token_hash" }, 400);
    const name = String(body.name ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 60);
    const { data: existing } = await db.from("devices").select("status").eq("token_hash", hash).maybeSingle();
    if (existing) return json({ success: true, device_status: existing.status, code: pairCode(hash) });

    // Housekeeping + flood limit: unapproved requests expire after a day, and only a few may arrive per hour.
    await db.from("devices").delete().eq("status", "pending").lt("created_at", new Date(Date.now() - 864e5).toISOString());
    const { count } = await db.from("devices").select("id", { count: "exact", head: true })
      .eq("status", "pending").gte("created_at", new Date(Date.now() - 36e5).toISOString());
    if ((count ?? 0) >= MAX_PENDING_PER_HOUR) return json({ success: false, message: "too many pairing requests, try later" }, 429);

    const { error } = await db.from("devices").insert({ token_hash: hash, pair_code: pairCode(hash), name });
    if (error && error.code !== "23505") return json({ success: false, message: "could not save" }, 500);
    await log("device_pair_request", null, { name, code: pairCode(hash) });
    return json({ success: true, device_status: "pending", code: pairCode(hash) });
  }

  // ---- watchdog: no auth, no data returned (see header) ----
  if (req.method === "POST" && body.action === "watchdog") return await watchdog();

  // ---- auth ----
  const authHeader = (req.headers.get("authorization") ?? "").trim();
  if (req.method === "POST" && body.action === "test_alert") return await testAlert(authHeader);
  if (req.method === "POST" && body.action === "test_wake") return await testWake(authHeader, String(body.device_id ?? ""));
  if (req.method === "POST" && body.action === "reparse") return await reparse(authHeader, body);
  const deviceKey = authHeader.match(/^Device\s+(\S{32,200})$/i)?.[1];
  let deviceId: string | null = null;
  let device: { id: string; name: string; pair_code: string; info: DeviceInfo | null; allow_balance: boolean; allow_cashin: boolean; allow_personal: boolean } | null = null;
  if (deviceKey) {
    const hash = await sha256hex(deviceKey);
    const { data: dev } = await db
      .from("devices")
      .select("id,status,name,pair_code,info,silent_alerted_at,allow_balance,allow_cashin,allow_personal")
      .eq("token_hash", hash)
      .maybeSingle();
    if (!dev) return json({ success: false, message: "this phone is not paired", device_status: "unknown" }, 401);
    if (dev.status === "pending") {
      return json({ success: false, message: "waiting for approval in the dashboard (code " + pairCode(hash) + ")", device_status: "pending" }, 403);
    }
    if (dev.status !== "approved") return json({ success: false, message: "this phone was removed in the dashboard", device_status: dev.status }, 403);
    deviceId = dev.id;
    device = { id: dev.id, name: dev.name, pair_code: dev.pair_code, info: dev.info, allow_balance: dev.allow_balance !== false, allow_cashin: dev.allow_cashin === true, allow_personal: dev.allow_personal === true };
    // Any word from the phone counts as proof of life.
    const wasSilent = !!dev.silent_alerted_at;
    await db
      .from("devices")
      .update(wasSilent ? { last_seen_at: new Date().toISOString(), silent_alerted_at: null } : { last_seen_at: new Date().toISOString() })
      .eq("id", dev.id);
    if (wasSilent) {
      await log("phone_recovered", null, { device_id: dev.id, name: dev.name });
      defer(notify.send(recoveredMessage({ name: dev.name, code: dev.pair_code })));
    }
  } else {
    if (!INGEST_SECRET || INGEST_SECRET.length < 16) return json({ success: false, message: "unauthorized" }, 401);
    const supplied = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!supplied || !safeEqual(supplied, INGEST_SECRET)) {
      return json({ success: false, message: "unauthorized" }, 401);
    }
  }

  // ---- heartbeat: "I am alive", plus what the phone can see about itself ----
  if (body.action === "heartbeat") {
    if (!device) return json({ success: true, message: "heartbeat ok" }); // shared-secret setups have no phone record
    const info = cleanInfo(body);
    await db.from("devices").update({ info }).eq("id", device.id);
    // The phone's push address, for wake-ups. Kept in a table the dashboard cannot read.
    const pushToken = typeof body.push_token === "string" ? body.push_token : "";
    if (/^[A-Za-z0-9:_\-]{100,400}$/.test(pushToken)) {
      await db.from("device_push").upsert({ device_id: device.id, token: pushToken, updated_at: new Date().toISOString() }, { onConflict: "device_id" });
    }
    const problem = healthProblem(info);
    // Tell the owner when a problem appears, not on every heartbeat while it lasts.
    if (problem && problem !== healthProblem(device.info)) {
      await log("phone_problem", null, { device_id: device.id, name: device.name, problem });
      defer(notify.send(problemMessage({ name: device.name, code: device.pair_code, problem, dashboardUrl: DASHBOARD_URL })));
    }
    // The jobs this phone has right now ride back on the reply (the short form), so the app can ring and notify within 30 seconds
    // without a second request. Left out when the lookup fails: the app then changes nothing.
    const { data: jobData, error: jobError } = await db.rpc("device_jobs", { p_device: device.id });
    const brief = jobError
      ? null
      : (((jobData as { jobs?: Array<Record<string, unknown>> } | null)?.jobs) ?? []).map((j) => ({
          kind: j.kind ?? "send", provider: j.provider, agent: j.agent, urgency: j.urgency, balance: j.balance, balance_at: j.balance_at,
        }));
    // A command the owner queued for this phone (read a balance, send a cash-in, fetch the wallet's statement). Taking
    // it marks it running; a lookup failure just means "none this time". A cash-in has to carry how much and to whom,
    // or the phone has nothing to act on; a statement carries which entry to open. Nothing secret travels: the PIN
    // lives only on the phone.
    const { data: cmdData, error: cmdError } = await db.rpc("device_next_command", { p_device: device.id });
    const cmd = cmdError
      ? null
      : (cmdData as { id?: string; kind?: string; provider?: string; amount?: number | string | null; to_number?: string | null; item?: number | null; via?: string | null; look?: unknown } | null);
    const command = cmd && cmd.id
      ? {
        id: cmd.id,
        kind: cmd.kind,
        provider: cmd.provider,
        ...(cmd.amount == null ? {} : { amount: Number(cmd.amount) }),
        ...(cmd.to_number == null ? {} : { to_number: cmd.to_number }),
        ...(cmd.item == null ? {} : { item: Number(cmd.item) }),
        // migration 082: a bKash Cash In may be told to go through the bKash app instead of USSD (old builds ignore it, and the
        // database only lets a phone that reported app_cashin be given one).
        ...(cmd.via === "app" ? { via: "app" } : {}),
        // What an app read should look for: how far back, and which rows to open for their TrxID (migration 086).
        ...(cmd.kind === "appread" && cmd.look && typeof cmd.look === "object" ? { look: cmd.look } : {}),
      }
      : null;
    return json({
      success: true, message: "heartbeat ok", device_status: "approved",
      ...(brief ? { jobs: brief } : {}),
      ...(command ? { command } : {}),
      // What the owner has allowed this phone to do, set on the dashboard. The phone follows it; sending money is off unless switched on.
      // personal (migration 065): the phone shows its Personal accounts section only while this is on.
      allow: { balance: device.allow_balance, cashin: device.allow_cashin, personal: device.allow_personal },
    });
  }

  // ---- command_result: what the phone found when it ran a dashboard command ----
  if (body.action === "command_result") {
    if (!device) return json({ success: false, message: "not a phone" }, 400);
    const id = typeof body.id === "string" ? body.id : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return json({ success: false, message: "bad id" }, 400);
    const ok = body.ok === true;
    // Older app builds say nothing about which command they ran, and those only ever read a balance.
    const kind = typeof body.kind === "string" && /^[a-z_]{1,20}$/.test(body.kind) ? body.kind : "balance";
    const balance = typeof body.balance === "number" && Number.isFinite(body.balance) && body.balance >= 0 && body.balance < 1e9 ? Math.round(body.balance * 100) / 100 : null;
    if (ok && kind === "balance" && balance === null) return json({ success: false, message: "a successful balance check needs the balance" }, 400);
    const error = typeof body.error === "string" && /^[a-z_]{1,40}$/.test(body.error) ? body.error : "failed";
    // A cash-in that went through also carries the wallet's own receipt number.
    const trx = typeof body.trx_id === "string" && /^[A-Za-z0-9]{1,24}$/.test(body.trx_id) ? body.trx_id : null;
    // A statement brings back the wallet's own screens, word for word. Kept as text and never trusted as instructions:
    // the dashboard reads them, so a wording change never needs a new app on every phone.
    const screens = Array.isArray(body.screens)
      ? body.screens.filter((x): x is string => typeof x === "string").slice(0, 12).map((x) => x.slice(0, 2000))
      : null;
    if (ok && kind === "statement" && (!screens || screens.length === 0)) {
      return json({ success: false, message: "a statement needs the screens" }, 400);
    }
    const { error: rpcError } = await db.rpc("device_command_finish", {
      p_device: device.id, p_id: id, p_ok: ok, p_balance: balance, p_trx: trx,
      p_screens: screens, p_error: ok ? null : error,
    });
    if (rpcError) {
      console.error("device_command_finish failed", rpcError.code);
      return json({ success: false, message: "could not save the result" }, 500);
    }
    // Was this command PayTrace's own question about a held payment? Then judge the answer (migration 053).
    defer(judgeWalletCheck(id, ok, balance, screens, error));
    // A statement list feeds the wallet ledger (migration 059).
    if (ok && kind === "statement" && screens && screens.length > 0) defer(recordStatement(id, screens, device.name));
    // A bKash app read judged the wallet's held payments in the database (migration 085): tell the owner what it found.
    if (ok && kind === "appread") defer(tellAppVerdicts(id, device.name));
    return json({ success: true });
  }

  // ---- earnings: what this phone's own app shows. Empty unless the owner switched it on for this phone. ----
  if (body.action === "earnings") {
    if (!device) return json({ success: true, enabled: false }); // shared-secret setups have no phone record
    const { data, error } = await db.rpc("device_earnings", { p_device: device.id });
    if (error) {
      console.error("device_earnings failed", error.code);
      return json({ success: false, message: "could not load earnings" }, 500);
    }
    return json({ success: true, ...((data ?? { enabled: false }) as Record<string, unknown>), device_status: "approved" });
  }

  // ---- jobs: the work the owner wrote in the dashboard, shown when this phone's balance reaches the amount they set ----
  if (body.action === "jobs") {
    if (!device) return json({ success: true, jobs: [] }); // shared-secret setups have no phone record
    const { data, error } = await db.rpc("device_jobs", { p_device: device.id });
    if (error) {
      console.error("device_jobs failed", error.code);
      return json({ success: false, message: "could not load jobs" }, 500);
    }
    const d = data as { jobs?: unknown[]; transfers?: unknown[] } | null;
    return json({ success: true, jobs: d?.jobs ?? [], transfers: d?.transfers ?? [] });
  }
  // The partner says how much they sent and the P2P charge; the next Cash Out message for that wallet checks it (migration 024).
  if (body.action === "job_sent" || body.action === "job_fix") {
    if (!device) return json({ success: false, message: "not paired" }, 403);
    const amount = Number(body.amount);
    const charge = body.charge == null || body.charge === "" ? 0 : Number(body.charge);
    const { cost, costNote } = costOf(body);
    if (!Number.isFinite(amount) || !Number.isFinite(charge) || !Number.isFinite(cost)) return json({ success: false, message: "bad_amount" }, 400);
    const extra = { p_cost: cost, p_cost_note: costNote };
    const { data, error } = body.action === "job_sent"
      ? await db.rpc("device_job_sent", { p_device: device.id, p_provider: String(body.provider ?? ""), p_amount: amount, p_charge: charge, ...extra })
      : await db.rpc("device_job_fix", { p_device: device.id, p_id: String(body.id ?? ""), p_amount: amount, p_charge: charge, ...extra });
    if (error) {
      console.error(body.action + " failed", error.code);
      return json({ success: false, message: "could not save" }, 500);
    }
    return json({ success: true, ...((data ?? { ok: false }) as Record<string, unknown>) });
  }
  // Cash-in job (migration 035): the partner cashed in to the personal number and types the amount and the cash-in commission the wallet gave
  // (it is added to the balance and no SMS is sent for it); the next Cash Out message for that wallet checks it.
  if (body.action === "cashin_sent" || body.action === "cashin_fix") {
    if (!device) return json({ success: false, message: "not paired" }, 403);
    const amount = Number(body.amount);
    const commission = body.commission == null || body.commission === "" ? 0 : Number(body.commission);
    const { cost, costNote } = costOf(body);
    if (!Number.isFinite(amount) || !Number.isFinite(commission) || !Number.isFinite(cost)) return json({ success: false, message: "bad_amount" }, 400);
    const extra = { p_cost: cost, p_cost_note: costNote };
    const { data, error } = body.action === "cashin_sent"
      ? await db.rpc("device_cashin_sent", { p_device: device.id, p_provider: String(body.provider ?? ""), p_amount: amount, p_commission: commission, ...extra })
      : await db.rpc("device_cashin_fix", { p_device: device.id, p_id: String(body.id ?? ""), p_amount: amount, p_commission: commission, ...extra });
    if (error) {
      console.error(body.action + " failed", error.code);
      return json({ success: false, message: "could not save" }, 500);
    }
    return json({ success: true, ...((data ?? { ok: false }) as Record<string, unknown>) });
  }
  // The agent says the work is done; the job stays hidden until a newer balance message arrives.
  if (body.action === "job_done") {
    if (!device) return json({ success: false, message: "not paired" }, 403);
    const provider = String(body.provider ?? "");
    const { data, error } = await db.rpc("device_job_done", { p_device: device.id, p_provider: provider });
    if (error) {
      console.error("device_job_done failed", error.code);
      return json({ success: false, message: "could not save" }, 500);
    }
    return json({ success: true, done: data === true });
  }
  // One screen of the bKash app recorder (migration 087): stored for mapping the app, never acted on.
  if (body.action === "app_screen") {
    if (!device) return json({ success: false, message: "not paired" }, 403);
    const cmd = String(body.command_id ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cmd)) return json({ success: false, message: "bad command" }, 400);
    const { data, error } = await db.rpc("app_screen_add", {
      p_device: device.id,
      p_command: cmd,
      p_seq: Math.trunc(Number(body.seq)),
      p_pkg: String(body.pkg ?? "").slice(0, 120),
      p_screen: String(body.screen ?? "").slice(0, 9000),
    });
    if (error) {
      console.error("app_screen_add failed", error.code);
      return json({ success: false, message: "could not save" }, 500);
    }
    return json({ success: true, ...((data ?? { ok: false }) as Record<string, unknown>) });
  }

  // "We just did a B2B" from the phone's Home button (migration 070): this wallet's statement is read now, so the entry is
  // saved before it can scroll off the wallet's list. Nothing is counted from the tap itself.
  if (body.action === "b2b_done") {
    if (!device) return json({ success: false, message: "not paired" }, 403);
    const { data, error } = await db.rpc("statement_now", { p_device: device.id, p_provider: String(body.provider ?? ""), p_why: "b2b", p_by: "app" });
    if (error) {
      console.error("statement_now failed", error.code);
      return json({ success: false, message: "could not save" }, 500);
    }
    return json({ success: true, ...((data ?? { ok: false }) as Record<string, unknown>) });
  }

  const str = (k: string) => (body[k] == null ? "" : String(body[k]).slice(0, 2000));
  const raw = str("raw_message");
  const hint = str("platform").toLowerCase();
  const senderId = str("sender_id");
  // Which SIM the SMS arrived on (0 = SIM 1, 1 = SIM 2). An old app build sends none: unknown, judged as before.
  const simSlot = simSlotOf(body.sim_slot);

  // ---- connection test: acknowledge, store nothing ----
  if (body.test === true || body.test === "true" || /^TEST/i.test(str("trx_id"))) {
    await log("test", hint || null, { note: "connection test", device_id: deviceId });
    return json({ success: true, message: "Connection OK", test: true, device_status: deviceId ? "approved" : null });
  }

  if (!raw) return json({ success: false, message: "raw_message required" }, 400);
  return await storeSms({ raw, hint, senderId, deviceId, simSlot, deviceName: device?.name ?? "" });
}

/** What a job cost the partner besides the commission/charge, and what for (migration 076). An older app sends neither: 0 and no note.
 *  The note is the partner's own words, kept short; the database strips control characters again. */
function costOf(body: Record<string, unknown>): { cost: number; costNote: string | null } {
  const cost = body.cost == null || body.cost === "" ? 0 : Number(body.cost);
  const note = typeof body.cost_note === "string" ? body.cost_note.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200) : "";
  return { cost, costNote: note || null };
}

/** 0 or 1 (as a number or as text, for the GET setting), else null = the phone did not say. */
function simSlotOf(v: unknown): number | null {
  return v === 0 || v === "0" ? 0 : v === 1 || v === "1" ? 1 : null;
}

/** One SMS to read and store. `rerun`: the owner pressed "Run the parser again" on a message that could not be read
 *  before (nothing is logged twice and no alert is sent); `legacyTrusted`: that message was logged before the sender ID
 *  was kept, and it came from a paired phone, which only forwards the four provider sender IDs in the first place. */
type SmsSource = { raw: string; hint: string; senderId: string; deviceId: string | null; simSlot?: number | null; deviceName?: string; rerun?: boolean; legacyTrusted?: boolean };

async function storeSms(src: SmsSource): Promise<Response> {
  const { raw, hint, senderId, deviceId } = src;
  const simSlot = src.simSlot ?? null;
  // ---- parse on the server (so parser fixes never need an app update) ----
  const result = parseSms(raw, hint);
  if (result.kind === "ignored") {
    if (!src.rerun) await log("ignored", hint || null, { reason: result.reason, raw });
    return json({ success: true, message: "ignored: not a payment", ignored: true });
  }
  if (result.kind === "failed") {
    if (!src.rerun) {
      // The sender and the phone are kept so the message can be read again once the parser knows its layout.
      await log("parse_failed", hint || null, { reason: result.reason, raw, sender_id: senderId || null, device_id: deviceId, sim_slot: simSlot });
      defer(alertUnread(hint || null, result.reason));
    }
    // success:true so the app stops retrying; the text is kept in the log for review
    return json({ success: true, message: "stored for review: could not parse", parsed: false, reason: result.reason });
  }
  const d = result.data;

  // ---- sender must really be the provider's SMS ID (blocks look-alike texts from normal numbers).
  //      Required, not optional: a payload without one cannot be shown to be genuine. ----
  if (!senderMatchesProvider(senderId, d.provider as Provider) && !(src.rerun && src.legacyTrusted && !senderId)) {
    await log("rejected_sender", d.provider, { sender_id: senderId || null, trx_id: d.trxId });
    return json({ success: false, message: "sender not recognized" }, 403);
  }

  // ---- provider toggle held on the server too ----
  const { data: settings } = await db.from("settings").select("enabled_providers").eq("id", true).single();
  if (settings && !settings.enabled_providers.includes(d.provider)) {
    await log("provider_disabled", d.provider, { trx_id: d.trxId });
    return json({ success: true, message: "provider disabled on server", ignored: true });
  }

  // ---- not one of this phone's wallets (migration 064): a wallet that is not set up in the app on that phone is not
  //      ours. Stored for the record only: no totals, no balance, no chain, no gap, no job, no alert. A phone with no
  //      wallet set up at all is treated as before (the rule cannot tell what is ours there). ----
  if (deviceId) {
    const { data: ours, error: oursError } = await db.rpc("wallet_is_ours", { p_device: deviceId, p_provider: d.provider, p_sim: simSlot });
    if (!oursError && ours === false) {
      const outgoingNow = d.txnType === "transfer_out" || d.txnType === "transfer_in";
      const { data: kept, error: keepError } = await db
        .from("payments")
        .insert({
          provider: d.provider, txn_type: outgoingNow ? "unknown" : d.txnType, trx_id: d.trxId,
          amount: d.amount, fee: d.fee, commission: d.commission, balance: d.balance,
          counterparty: d.counterparty, occurred_at: d.occurredAt,
          raw_message: raw, status: "ignored", review_reason: "not_ours",
          balance_delta: null, chain_status: "unverified",
          device_id: deviceId, sim_slot: simSlot,
        })
        .select("id")
        .single();
      if (keepError) {
        if (keepError.code === "23505") return json({ success: true, message: "Duplicate: already recorded", duplicate: true });
        await log("error", d.provider, { code: keepError.code });
        return json({ success: false, message: "could not save" }, 500);
      }
      if (!src.rerun) await log("created", d.provider, { trx_id: d.trxId, type: d.txnType, amount: d.amount, device_id: deviceId, sim_slot: simSlot, not_ours: true }, kept.id);
      return json({ success: true, message: "stored: not one of this phone's wallets", payment_id: kept.id, status: "ignored", not_ours: true });
    }
  }

  // ---- balance chain: a forged SMS cannot know the live account balance ----
  // Money the agent SENT OUT (B2B to the distributor, a cash-in, a bill) lowers the balance: judge it as a negative amount.
  // Money that came in on the agent's own side (B2B from the distributor, a cash-in from an agent) raises it like a payment.
  const outgoing = d.txnType === "transfer_out";
  const incoming = d.txnType === "transfer_in";
  const { data: chain } = await db.rpc("balance_chain_check", {
    p_provider: d.provider,
    p_at: d.occurredAt ?? new Date().toISOString(),
    p_balance: d.balance,
    p_amount: outgoing ? -d.amount : d.amount,
    p_fee: d.fee,
    p_commission: d.commission,
    // Judged against THIS phone's previous message (migration 051): one phone is one wallet per provider. Null only on
    // the old shared-secret path, where the function falls back to the provider-wide chain.
    p_device: deviceId,
    // ...and inside the same SIM (migration 058): two wallets of the same kind on one phone are two chains.
    p_sim: simSlot,
  });
  const chainStatus: string = chain?.status ?? "unverified";
  // bKash never states the agent commission; the balance does. Trust it only on a sound chain.
  const commission =
    d.commission > 0 ? d.commission : chainStatus === "ok" ? Number(chain?.commission ?? 0) : 0;

  // ---- status rules ----
  let status = "unmatched";
  let reviewReason: string | null = null;
  // Money moving on the agent's own side (B2B either way, the agent's cash-in to a customer, a bill, a merchant payment,
  // a loan repayment) is kept, because its balance keeps the chain and the phone's balance right, but is never money
  // received from a customer: stored as type unknown, status ignored, so no total, commission, job check or lookup counts
  // it. The Cash In column does count cash_in_sent. ONE exception is held instead of ignored: a cash-in that came INTO the
  // wallet from an agent (cash_in_received) could be a customer who paid at an agent counter, so a person decides.
  if (outgoing) { status = "ignored"; reviewReason = OUT_REASON[d.flowKind ?? "b2b"] ?? "b2b_transfer_out"; }
  else if (incoming && d.flowKind === "cash_in") { status = "review"; reviewReason = "cash_in_received"; }
  else if (incoming) { status = "ignored"; reviewReason = "b2b_received"; }
  else if (d.txnType === "cash_out") status = "tracked_only"; // receipts only, never credit an order
  else if (d.txnType === "unknown") { status = "review"; reviewReason = "unrecognized_type"; }
  else if (d.confidence === "generic") { status = "review"; reviewReason = "unverified_format"; }

  // A broken chain is only held back when this payment could actually credit an order.
  // An agent's balance also moves through cash-in, send money and bill pay, none of which
  // produce a message PayTrace stores, so a receipt that cannot pay for anything is marked
  // unconfirmed and left alone rather than filling the review queue with false alarms.
  if (chainStatus === "mismatch") {
    await log("balance_unconfirmed", d.provider, {
      trx_id: d.trxId, amount: d.amount, balance: d.balance,
      observed_change: chain?.delta ?? null, expected_change: chain?.expected ?? null,
      held: status !== "tracked_only",
    });
    if (status !== "tracked_only" && !outgoing && !incoming) {
      status = "review";
      reviewReason = "balance_chain_mismatch";
    }
  }

  // ---- insert; the unique (provider, trx_id) rule makes duplicates impossible ----
  const { data: inserted, error } = await db
    .from("payments")
    .insert({
      provider: d.provider, txn_type: outgoing || incoming ? "unknown" : d.txnType, trx_id: d.trxId,
      amount: d.amount, fee: d.fee, commission, balance: d.balance,
      counterparty: d.counterparty, occurred_at: d.occurredAt,
      raw_message: raw, status, review_reason: reviewReason,
      balance_delta: chain?.delta ?? null, chain_status: chainStatus,
      device_id: deviceId, sim_slot: simSlot,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      await log("duplicate", d.provider, { trx_id: d.trxId });
      return json({ success: true, message: "Duplicate: already recorded", duplicate: true });
    }
    await log("error", d.provider, { code: error.code });
    return json({ success: false, message: "could not save" }, 500); // app will retry
  }

  await log("created", d.provider, { trx_id: d.trxId, type: d.txnType, amount: d.amount, device_id: deviceId, chain: chainStatus, ...(src.rerun ? { rerun: true } : {}) }, inserted.id);

  // The balance moved more than this message explains: money came in or left with no SMS (migration 063).
  if (chainStatus === "mismatch" && d.balance != null && deviceId && !src.rerun) defer(recordGap(inserted.id, src.deviceName ?? ""));

  // B2B money moved (owner 2026-11-05): say so at once. OUT spends the owner's money; IN raises the wallet's B2B float.
  if (!src.rerun && (reviewReason === "b2b_transfer_out" || reviewReason === "b2b_received")) {
    defer(notify.send(b2bMessage({
      direction: reviewReason === "b2b_transfer_out" ? "out" : "in", provider: d.provider, amount: d.amount,
      phone: src.deviceName ?? "", how: "sms", balance: d.balance, trxId: d.trxId, dashboardUrl: DASHBOARD_URL,
    })));
  }

  // ---- try to match to an order that already claimed this TrxID ----
  let matchResult = status;
  // A Cash Out receipt is stored as tracked_only, but it can pay a deposit whose wallet is a Cash Out wallet.
  if (status === "unmatched" || status === "tracked_only") {
    const { data: r } = await db.rpc("reconcile_payment", { p_payment_id: inserted.id });
    if (typeof r === "string") matchResult = r;
    // A deposit order just got paid or held: tell its website now instead of waiting for the minute timer.
    if (matchResult === "matched" || matchResult === "review") {
      defer(fetch(`${SUPABASE_URL}/functions/v1/gateway/deliver`, { method: "POST", headers: DELIVER_AUTH, body: "{}" }).then((x) => x.body?.cancel()).catch(() => {}));
    }
  }

  // Held on arrival while a customer had already typed this TrxID: the order must say "held" too, and its website must
  // hear deposit.review rather than deposit.expired (migration 052). Nothing is credited here.
  if (status === "review") {
    const { data: heldOrder } = await db.rpc("hold_claimed_order", { p_payment_id: inserted.id });
    if (heldOrder) {
      defer(fetch(`${SUPABASE_URL}/functions/v1/gateway/deliver`, { method: "POST", headers: DELIVER_AUTH, body: "{}" }).then((x) => x.body?.cancel()).catch(() => {}));
    }
  }
  // A broken balance chain is a question for the phone, not a verdict: ask the wallet itself (live balance, then its
  // statement). Confirmed = released and matched; not confirmed = stays held and the owner is told (migration 053).
  if (status === "review" && reviewReason === "balance_chain_mismatch") await startWalletCheck(inserted.id);

  // Tell the owner when a payment is being held, whether that happened on arrival or while matching.
  if (matchResult === "review") {
    let reason = reviewReason;
    if (!reason) {
      const { data: row } = await db.from("payments").select("review_reason").eq("id", inserted.id).maybeSingle();
      reason = row?.review_reason ?? null;
    }
    defer(notify.send(reviewMessage({ provider: d.provider, amount: d.amount, trxId: d.trxId, reason, dashboardUrl: DASHBOARD_URL })));
  }
  return json({ success: true, message: "Payment received", payment_id: inserted.id, status: matchResult });
}

// The dashboard's address is the only website allowed to call this from a browser (see cors.ts).
const DASHBOARD_ORIGIN = new URL(DASHBOARD_URL).origin;
// The old address keeps working beside a new one, so switching the dashboard to its own domain never locks the owner out.
const LEGACY_DASHBOARD_ORIGIN = "https://paytrace.ashkawser54.workers.dev";

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"), [DASHBOARD_ORIGIN, LEGACY_DASHBOARD_ORIGIN]);
  // The browser's "may I?" question before a real request.
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const res = await handle(req);
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  return res;
});
