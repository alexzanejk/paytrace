import { planWake, runWake, WAKE_AFTER_SEC, type Pusher, type WakeResult, type WakeRow, type WakeStore } from "../supabase/functions/ingest/wake.ts";
import { makePusher, wakeMessage } from "../supabase/functions/ingest/fcm.ts";
import { corsHeaders } from "../supabase/functions/ingest/cors.ts";
import { cleanInfo } from "../supabase/functions/ingest/health.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

const NOW = Date.parse("2026-10-22T12:00:00Z");
const ago = (sec: number) => new Date(NOW - sec * 1000).toISOString();
const row = (id: string, quietSec: number | null, extra: Partial<WakeRow> = {}): WakeRow => ({
  id, name: id, token: "T".repeat(150), last_seen_at: quietSec === null ? null : ago(quietSec), approved_at: ago(99999), ...extra,
});

function fakeStore(rows: WakeRow[], claimResult: (id: string) => boolean = () => true) {
  const log = { claimed: [] as string[], nexts: [] as { tries: number; visible: boolean }[], forgot: [] as string[], events: [] as string[] };
  const store: WakeStore = {
    candidates: async () => rows,
    claim: async (id, _expected, next) => { log.claimed.push(id); log.nexts.push(next); return claimResult(id); },
    forget: async (id) => { log.forgot.push(id); },
    record: async (kind) => { log.events.push(kind); },
  };
  return { store, log };
}
const fakePush = (result: WakeResult, enabled = true) => {
  const sent: { token: string; visible: boolean }[] = [];
  const p: Pusher = { enabled, wake: async (t, visible = false) => { sent.push({ token: t, visible }); return result; } };
  return { p, sent };
};

// ---- decisions ----
{
  const { store, log } = fakeStore([row("quiet", 300), row("fresh", 20), row("edge", WAKE_AFTER_SEC - 1)]);
  const { p, sent } = fakePush("sent");
  const r = await runWake(store, p, { now: NOW });
  check("only the quiet phone is woken", r.woken === 1 && sent.length === 1 && log.claimed.join() === "quiet", log);
  check("a wake-up is recorded", log.events.join() === "phone_wake_sent");
  check("the first push is quiet (data only) and counts as try 1", sent[0].visible === false && log.nexts[0].tries === 1 && log.nexts[0].visible === false);
}
check("the first push goes out after 60 seconds of silence", WAKE_AFTER_SEC === 60 && planWake(row("a", 61), NOW)?.tries === 1 && planWake(row("a", 59), NOW) === null);
{
  const { store } = fakeStore([row("never", null, { approved_at: ago(600) }), row("new", null, { approved_at: ago(30) })]);
  const { p, sent } = fakePush("sent");
  await runWake(store, p, { now: NOW });
  check("a phone that never spoke is judged from its approval time", sent.length === 1);
}
{
  const { store, log } = fakeStore([row("a", 500)], () => false);
  const { p, sent } = fakePush("sent");
  const r = await runWake(store, p, { now: NOW });
  check("an overlapping run won: nothing is sent", r.woken === 0 && sent.length === 0 && log.events.length === 0);
}
{
  const { store, log } = fakeStore([row("a", 500)]);
  const { p } = fakePush("bad_token");
  await runWake(store, p, { now: NOW });
  check("an invalid address is forgotten", log.forgot.join() === "a" && log.events.join() === "phone_wake_bad_token");
}
{
  const { store, log } = fakeStore([row("a", 500)]);
  const { p } = fakePush("failed");
  const r = await runWake(store, p, { now: NOW });
  check("a failed send is recorded, not counted", r.woken === 0 && log.events.join() === "phone_wake_failed" && log.forgot.length === 0);
}
{
  const { store, log } = fakeStore([row("a", 500)]);
  const { p, sent } = fakePush("sent", false);
  const r = await runWake(store, p, { now: NOW });
  check("Firebase not set up: nothing happens", r.woken === 0 && sent.length === 0 && log.claimed.length === 0);
}

// ---- how hard we keep trying ----
{
  // Simulate a phone that stays silent: the watchdog runs once a minute and the plan is followed exactly.
  let d = row("a", 0, { last_seen_at: ago(0), woken_at: null, tries: 0, visible_at: null });
  const lastSeen = NOW;
  const pushes: { min: number; mode: string; tries: number }[] = [];
  for (let min = 0; min <= 16; min++) {
    const now = NOW + min * 60_000;
    const plan = planWake({ ...d }, now);
    if (plan) {
      pushes.push({ min, mode: plan.mode, tries: plan.tries });
      d = { ...d, woken_at: new Date(now).toISOString(), tries: plan.tries, visible_at: plan.mode === "visible" ? new Date(now).toISOString() : d.visible_at };
    }
  }
  const minutes = pushes.map((x) => x.min).join();
  check("pushes start at 2 minutes (60 s quiet + the next run) and repeat each minute for three tries, then every 2 minutes", minutes === "1,2,3,5,7,9,11,13,15", minutes);
  check("tries are counted 1, 2, 3, ...", pushes.map((x) => x.tries).join() === "1,2,3,4,5,6,7,8,9");
  const visible = pushes.filter((x) => x.mode === "visible").map((x) => x.min).join();
  check("a visible notification starts at the fourth try and then at most once per 10 minutes", visible === "5,15", visible);
  void lastSeen;
}
{
  // The phone speaks after the third push: the count starts over and the next silence is a fresh first try.
  const woke = ago(120);
  const answered = row("a", 90, { woken_at: woke, tries: 5, visible_at: ago(700) });
  // last_seen (90 s ago) is later than woken_at (120 s ago) -> it answered
  const plan = planWake(answered, NOW);
  check("after the phone answers, the next push is a fresh quiet try 1", plan?.tries === 1 && plan.mode === "data", plan);
}
{
  const justPushed = row("a", 300, { woken_at: ago(30), tries: 1 });
  check("too soon after a push: wait", planWake(justPushed, NOW) === null);
  const slow = row("a", 900, { woken_at: ago(100), tries: 4 });
  check("after three tries the gap is two minutes", planWake(slow, NOW) === null && planWake({ ...slow, woken_at: ago(116) }, NOW)?.tries === 5);
}

// ---- the Firebase message ----
const m = wakeMessage("TOKEN");
check("high priority, short lifetime, data only", m.message.android.priority === "HIGH" && m.message.android.ttl === "60s" && m.message.data.type === "wake" && !("notification" in m.message));
const mv = wakeMessage("TOKEN", true) as { message: { notification?: { title: string; body: string }; data: { type: string }; android: { priority: string; ttl: string } } };
check("the visible kind adds a small notification and keeps the wake data", mv.message.notification?.title === "PayTrace" && mv.message.data.type === "wake" && mv.message.android.priority === "HIGH" && mv.message.android.ttl === "120s");
check("makePusher without a key is disabled", makePusher(undefined).enabled === false && makePusher("not json").enabled === false && makePusher('{"project_id":"x"}').enabled === false);

// A real (throwaway) RSA key, so signing is exercised for real.
const kp = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"],
);
const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
let bin = ""; for (const b of der) bin += String.fromCharCode(b);
const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(bin).replace(/.{64}/g, "$&\n")}\n-----END PRIVATE KEY-----\n`;
const account = JSON.stringify({ project_id: "demo-proj", client_email: "svc@demo-proj.iam.gserviceaccount.com", private_key: pem });

function fakeFetch(fcmStatus: number) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "ACCESS", expires_in: 3600 }), { status: 200 });
    }
    return new Response("{}", { status: fcmStatus });
  }) as unknown as typeof fetch;
  return { f, calls };
}
{
  const { f, calls } = fakeFetch(200);
  const p = makePusher(account, f);
  check("with a key it is enabled", p.enabled);
  const res = await p.wake("tok");
  const auth = calls[0].init?.body as URLSearchParams;
  const jwt = String(auth.get("assertion")).split(".");
  const claims = JSON.parse(atob(jwt[1].replace(/-/g, "+").replace(/_/g, "/")));
  check("signs a three-part token for the right account and scope", jwt.length === 3 && claims.iss.startsWith("svc@") && claims.scope.endsWith("firebase.messaging"), claims);
  const sigOk = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", kp.publicKey,
    Uint8Array.from(atob(jwt[2].replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(jwt[2].length / 4) * 4, "=")), (c) => c.charCodeAt(0)),
    new TextEncoder().encode(jwt[0] + "." + jwt[1]),
  );
  check("the signature verifies with the matching public key", sigOk);
  check("sent to the project's FCM endpoint with the access token", res === "sent" && calls[1].url.includes("/projects/demo-proj/messages:send") && String((calls[1].init?.headers as Record<string, string>).authorization) === "Bearer ACCESS");
  await p.wake("tok2");
  check("the access token is reused", calls.filter((c) => c.url.includes("oauth2")).length === 1);
}
{
  const { f } = fakeFetch(404);
  check("404 means the address is no longer valid", (await makePusher(account, f).wake("t")) === "bad_token");
}
{
  const { f } = fakeFetch(500);
  check("a server error is a plain failure", (await makePusher(account, f).wake("t")) === "failed");
}

// ---- heartbeat ----
check("push_ready is kept as a true/false", cleanInfo({ push_ready: true }).push_ready === true && cleanInfo({ push_ready: "false" }).push_ready === false && cleanInfo({}).push_ready === undefined);

{
  const at = Date.parse("2026-10-22T09:00:00Z");
  const now = new Date("2026-10-22T10:00:00Z");
  const i = cleanInfo({ wake_count: 3, last_wake_at: at }, now);
  check("wake count and time are kept", i.wake_count === 3 && i.last_wake_at === new Date(at).toISOString(), i);
  check("a nonsense wake time is dropped", cleanInfo({ last_wake_at: 5 }, now).last_wake_at === undefined && cleanInfo({ last_wake_at: "x" }, now).last_wake_at === undefined);
  check("a wake time far in the future is dropped", cleanInfo({ last_wake_at: now.getTime() + 10 * 864e5 }, now).last_wake_at === undefined);
}

// ---- the dashboard may call the function from the browser; other sites may not ----
{
  const DASH = "https://paytrace.example.workers.dev";
  const ok = corsHeaders(DASH, DASH);
  check("the dashboard's address is allowed", ok["access-control-allow-origin"] === DASH && ok["access-control-allow-headers"].includes("authorization"), ok);
  check("another website gets no permission", Object.keys(corsHeaders("https://evil.example", DASH)).length === 0);
  check("a request with no origin (the phones) gets nothing added", Object.keys(corsHeaders(null, DASH)).length === 0);
  check("a look-alike address is not allowed", Object.keys(corsHeaders(DASH + ".evil.example", DASH)).length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
