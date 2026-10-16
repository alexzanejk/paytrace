import { runWatchdog, type WatchRow, type WatchStore } from "../supabase/functions/ingest/watchdog.ts";
import type { Notifier } from "../supabase/functions/ingest/notify.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

const NOW = Date.parse("2026-10-16T12:00:00Z");
const minsAgo = (m: number) => new Date(NOW - m * 60000).toISOString();
const row = (id: string, last: string | null, approved: string | null = minsAgo(5000)): WatchRow =>
  ({ id, name: "Phone " + id, pair_code: "AAAA-" + id, last_seen_at: last, approved_at: approved });

function setup(rows: WatchRow[], opts: { sendOk?: boolean; enabled?: boolean; claimTaken?: string[] } = {}) {
  const alerted = new Set<string>();
  const sent: string[] = [];
  const events: string[] = [];
  const store: WatchStore = {
    candidates: () => Promise.resolve(rows.filter((r) => !alerted.has(r.id))),
    claim: (id) => {
      if (opts.claimTaken?.includes(id) || alerted.has(id)) return Promise.resolve(false);
      alerted.add(id);
      return Promise.resolve(true);
    },
    release: (id) => { alerted.delete(id); return Promise.resolve(); },
    record: (kind) => { events.push(kind); return Promise.resolve(); },
  };
  const notify: Notifier = {
    enabled: opts.enabled ?? true,
    send: (t) => { sent.push(t); return Promise.resolve(opts.sendOk ?? true); },
  };
  const run = () => runWatchdog(store, notify, { now: NOW, silentAfterMin: 90, dashboardUrl: "https://x.dev" });
  return { run, sent, events, alerted };
}

// a phone heard from recently is left alone
let t = setup([row("a", minsAgo(10))]);
check("recent phone: no alert", (await t.run()).alerted === 0 && t.sent.length === 0);

// quiet for longer than 90 minutes is reported, once
t = setup([row("a", minsAgo(120))]);
check("quiet phone: one alert", (await t.run()).alerted === 1 && t.sent.length === 1);
check("alert names the phone and how long", t.sent[0].includes("Phone a") && t.sent[0].includes("2 h"), t.sent[0]);
check("alert is recorded in the log", t.events.includes("phone_silent"));
await t.run();
check("a second run does not repeat the alert", t.sent.length === 1);

// exactly on the line counts as silent; just under does not
check("89 min: not yet", (await setup([row("a", minsAgo(89))]).run()).alerted === 0);
check("90 min: silent", (await setup([row("a", minsAgo(90))]).run()).alerted === 1);

// a phone approved but never heard from is judged from its approval time
check("never spoke, approved long ago: alert", (await setup([row("a", null, minsAgo(300))]).run()).alerted === 1);
check("never spoke, approved just now: wait", (await setup([row("a", null, minsAgo(3))]).run()).alerted === 0);
check("no timestamps at all: skipped, not alerted", (await setup([row("a", null, null)]).run()).alerted === 0);

// several phones
t = setup([row("a", minsAgo(200)), row("b", minsAgo(5)), row("c", minsAgo(500))]);
check("only the quiet ones are alerted", (await t.run()).alerted === 2 && t.sent.length === 2);

// Telegram down: nothing is lost, the next run tries again
t = setup([row("a", minsAgo(200))], { sendOk: false });
check("failed send: not counted", (await t.run()).alerted === 0);
check("failed send: claim released so it retries", !t.alerted.has("a"));
check("failed send: nothing recorded as sent", !t.events.includes("phone_silent"));

// two runs overlapping: the second one loses the claim and stays quiet
t = setup([row("a", minsAgo(200))], { claimTaken: ["a"] });
check("claim already taken: no duplicate alert", (await t.run()).alerted === 0 && t.sent.length === 0);

// not set up yet: nobody is marked as alerted, so they are reported once it is
t = setup([row("a", minsAgo(200))], { enabled: false });
check("no Telegram: no alert", (await t.run()).alerted === 0 && t.sent.length === 0);
check("no Telegram: phone stays un-alerted for later", t.alerted.size === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
