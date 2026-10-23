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
import { makeNotifier, problemMessage, recoveredMessage, reviewMessage, testMessage } from "./notify.ts";
import { runWatchdog } from "./watchdog.ts";
import { runWake } from "./wake.ts";
import { makePusher } from "./fcm.ts";
import { corsHeaders } from "./cors.ts";

// Supabase's runtime lets work finish after the response is sent. Absent when run elsewhere (tests).
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;
const defer = (p: Promise<unknown>) => {
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(p);
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const INGEST_SECRET = Deno.env.get("INGEST_SECRET") ?? "";
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

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
        const { data: toks } = await db.from("device_push").select("device_id,token");
        const byId = new Map((toks ?? []).map((t) => [t.device_id as string, t.token as string]));
        return (devs ?? []).filter((d) => byId.has(d.id)).map((d) => ({ ...d, token: byId.get(d.id)! }));
      },
      async claim(id, cooldownMin) {
        const cutoff = new Date(Date.now() - cooldownMin * 60_000).toISOString();
        const { data } = await db
          .from("device_push")
          .update({ woken_at: new Date().toISOString() })
          .eq("device_id", id)
          .or(`woken_at.is.null,woken_at.lt.${cutoff}`)
          .select("device_id");
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
  const deviceKey = authHeader.match(/^Device\s+(\S{32,200})$/i)?.[1];
  let deviceId: string | null = null;
  let device: { id: string; name: string; pair_code: string; info: DeviceInfo | null } | null = null;
  if (deviceKey) {
    const hash = await sha256hex(deviceKey);
    const { data: dev } = await db
      .from("devices")
      .select("id,status,name,pair_code,info,silent_alerted_at")
      .eq("token_hash", hash)
      .maybeSingle();
    if (!dev) return json({ success: false, message: "this phone is not paired", device_status: "unknown" }, 401);
    if (dev.status === "pending") {
      return json({ success: false, message: "waiting for approval in the dashboard (code " + pairCode(hash) + ")", device_status: "pending" }, 403);
    }
    if (dev.status !== "approved") return json({ success: false, message: "this phone was removed in the dashboard", device_status: dev.status }, 403);
    deviceId = dev.id;
    device = { id: dev.id, name: dev.name, pair_code: dev.pair_code, info: dev.info };
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
          provider: j.provider, agent: j.agent, urgency: j.urgency, balance: j.balance, balance_at: j.balance_at,
        }));
    return json({ success: true, message: "heartbeat ok", device_status: "approved", ...(brief ? { jobs: brief } : {}) });
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
    return json({ success: true, jobs: (data as { jobs?: unknown[] } | null)?.jobs ?? [] });
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

  const str = (k: string) => (body[k] == null ? "" : String(body[k]).slice(0, 2000));
  const raw = str("raw_message");
  const hint = str("platform").toLowerCase();
  const senderId = str("sender_id");

  // ---- connection test: acknowledge, store nothing ----
  if (body.test === true || body.test === "true" || /^TEST/i.test(str("trx_id"))) {
    await log("test", hint || null, { note: "connection test", device_id: deviceId });
    return json({ success: true, message: "Connection OK", test: true, device_status: deviceId ? "approved" : null });
  }

  if (!raw) return json({ success: false, message: "raw_message required" }, 400);

  // ---- parse on the server (so parser fixes never need an app update) ----
  const result = parseSms(raw, hint);
  if (result.kind === "ignored") {
    await log("ignored", hint || null, { reason: result.reason, raw });
    return json({ success: true, message: "ignored: not a payment", ignored: true });
  }
  if (result.kind === "failed") {
    await log("parse_failed", hint || null, { reason: result.reason, raw });
    // success:true so the app stops retrying; the text is kept in the log for review
    return json({ success: true, message: "stored for review: could not parse", parsed: false });
  }
  const d = result.data;

  // ---- sender must really be the provider's SMS ID (blocks look-alike texts from normal numbers).
  //      Required, not optional: a payload without one cannot be shown to be genuine. ----
  if (!senderMatchesProvider(senderId, d.provider as Provider)) {
    await log("rejected_sender", d.provider, { sender_id: senderId || null, trx_id: d.trxId });
    return json({ success: false, message: "sender not recognized" }, 403);
  }

  // ---- provider toggle held on the server too ----
  const { data: settings } = await db.from("settings").select("enabled_providers").eq("id", true).single();
  if (settings && !settings.enabled_providers.includes(d.provider)) {
    await log("provider_disabled", d.provider, { trx_id: d.trxId });
    return json({ success: true, message: "provider disabled on server", ignored: true });
  }

  // ---- balance chain: a forged SMS cannot know the live account balance ----
  const { data: chain } = await db.rpc("balance_chain_check", {
    p_provider: d.provider,
    p_at: d.occurredAt ?? new Date().toISOString(),
    p_balance: d.balance,
    p_amount: d.amount,
    p_fee: d.fee,
    p_commission: d.commission,
  });
  const chainStatus: string = chain?.status ?? "unverified";
  // bKash never states the agent commission; the balance does. Trust it only on a sound chain.
  const commission =
    d.commission > 0 ? d.commission : chainStatus === "ok" ? Number(chain?.commission ?? 0) : 0;

  // ---- status rules ----
  let status = "unmatched";
  let reviewReason: string | null = null;
  if (d.txnType === "cash_out") status = "tracked_only"; // receipts only, never credit an order
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
    if (status !== "tracked_only") {
      status = "review";
      reviewReason = "balance_chain_mismatch";
    }
  }

  // ---- insert; the unique (provider, trx_id) rule makes duplicates impossible ----
  const { data: inserted, error } = await db
    .from("payments")
    .insert({
      provider: d.provider, txn_type: d.txnType, trx_id: d.trxId,
      amount: d.amount, fee: d.fee, commission, balance: d.balance,
      counterparty: d.counterparty, occurred_at: d.occurredAt,
      raw_message: raw, status, review_reason: reviewReason,
      balance_delta: chain?.delta ?? null, chain_status: chainStatus,
      device_id: deviceId,
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

  await log("created", d.provider, { trx_id: d.trxId, type: d.txnType, amount: d.amount, device_id: deviceId, chain: chainStatus }, inserted.id);

  // ---- try to match to an order that already claimed this TrxID ----
  let matchResult = status;
  // A Cash Out receipt is stored as tracked_only, but it can pay a deposit whose wallet is a Cash Out wallet.
  if (status === "unmatched" || status === "tracked_only") {
    const { data: r } = await db.rpc("reconcile_payment", { p_payment_id: inserted.id });
    if (typeof r === "string") matchResult = r;
    // A deposit order just got paid or held: tell its website now instead of waiting for the minute timer.
    if (matchResult === "matched" || matchResult === "review") {
      defer(fetch(`${SUPABASE_URL}/functions/v1/gateway/deliver`, { method: "POST", body: "{}" }).then((x) => x.body?.cancel()).catch(() => {}));
    }
  }

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

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"), DASHBOARD_ORIGIN);
  // The browser's "may I?" question before a real request.
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const res = await handle(req);
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  return res;
});
