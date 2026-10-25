import {
  blockingProblems, agoText, deviceHealth, infoProblems, minutesSince, OFFLINE_AFTER_SEC, ALERT_AFTER_MIN,
} from "../dashboard/src/lib/deviceHealth.ts";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

const NOW = Date.parse("2026-10-16T12:00:00Z");
const ago = (m: number) => new Date(NOW - m * 60000).toISOString();
const h = (last: string | null, approved: string | null = ago(5000)) => deviceHealth({ last_seen_at: last, approved_at: approved }, NOW);

const secAgo = (sec: number) => new Date(NOW - sec * 1000).toISOString();
check("10 seconds ago is online", h(secAgo(10)).level === "online");
check("one missed heartbeat (45 s) is still online", h(secAgo(45)).level === "online");
check("just under the offline line is online", h(secAgo(OFFLINE_AFTER_SEC - 1)).level === "online");
check("at the offline line is offline", h(secAgo(OFFLINE_AFTER_SEC)).level === "offline");
check("two minutes ago is offline", h(ago(2)).level === "offline");
check("two days ago is offline", h(ago(2880)).level === "offline");
check("the offline line is no more than a minute and a half", OFFLINE_AFTER_SEC <= 90);

// the Telegram alert (server) and the dashboard must agree on the alert delay
const server = readFileSync(new URL("../supabase/functions/ingest/index.ts", import.meta.url), "utf8");
const serverLine = Number(server.match(/const ALERT_AFTER_MIN = (\d+);/)?.[1]);
check("dashboard and Telegram agree on the alert delay", serverLine === ALERT_AFTER_MIN, { serverLine, ALERT_AFTER_MIN });
check("the Telegram alert waits longer than the dashboard's Offline label", ALERT_AFTER_MIN * 60 > OFFLINE_AFTER_SEC);

// never spoke: judged from approval
check("never spoke, approved 30 s ago: fine", h(null, secAgo(30)).level === "online" && h(null, secAgo(30)).neverSpoke);
check("never spoke, approved 5 hours ago: offline", h(null, ago(300)).level === "offline");

// a browser clock a little behind the server
check("future timestamp is clamped, not negative", (minutesSince(new Date(NOW + 120000).toISOString(), NOW) ?? -1) === 0);
check("junk timestamp is unknown", minutesSince("not a date", NOW) === null);

check("ago: just now", agoText(0.2) === "just now");
check("ago: 40 seconds is still just now", agoText(40 / 60) === "just now");
check("ago: minutes", agoText(12) === "12 min ago");
check("ago: hours and minutes", agoText(125) === "2 h 5 min ago");
check("ago: whole hours", agoText(120) === "2 h ago");
check("ago: days", agoText(1500) === "1 d 1 h ago");
check("ago: never", agoText(null) === "never");

check("healthy report has no problems", infoProblems({ monitoring: true, sms_permission: true, failed: 0 }).length === 0);
check("battery saver allowed to stop the app is flagged", infoProblems({ battery_exempt: false }).some((p) => /Battery saver/.test(p)));
check("notifications off is flagged", infoProblems({ notifications: false }).some((p) => /Notifications are off/.test(p)));
check("...neither is a red-banner problem", blockingProblems({ battery_exempt: false, notifications: false }).length === 0);
check("stopped by the phone is flagged with the count", infoProblems({ stopped_count: 2, last_gap_min: 14 }).some((p) => /stopped PayTrace 2 times/.test(p) && /14 min/.test(p)));
check("stopped once is singular", infoProblems({ stopped_count: 1, last_gap_min: 6 }).some((p) => /1 time \(/.test(p)));
check("a failed screen-off test is flagged with the silence length", infoProblems({ keepalive_test: "fail", keepalive_gap_s: 240 }).some((p) => /screen-off test failed/.test(p) && /240 seconds/.test(p)));
check("a passed screen-off test is not a problem", infoProblems({ keepalive_test: "pass", keepalive_gap_s: 31 }).length === 0);
check("a failed test is not a red-banner problem", blockingProblems({ keepalive_test: "fail" }).length === 0);
check("never stopped is fine", infoProblems({ stopped_count: 0 }).length === 0);
check("being stopped is not a red-banner problem", blockingProblems({ stopped_count: 4 }).length === 0);
check("no report has no problems", infoProblems(null).length === 0 && infoProblems(undefined).length === 0);
check("sms permission off is flagged", infoProblems({ sms_permission: false }).some((p) => /SMS permission/.test(p)));
check("monitoring off is flagged", infoProblems({ monitoring: false }).some((p) => /not being forwarded/.test(p)));
check("failed sends are counted, singular", infoProblems({ failed: 1 })[0] === "1 message could not be sent");
check("failed sends are counted, plural", infoProblems({ failed: 4 })[0] === "4 messages could not be sent");

check("no read-old-SMS permission is flagged", infoProblems({ inbox_permission: false }).some((p) => /Reading old SMS is off/.test(p)));
check("...but it is not a red-banner problem, nothing is being lost right now", blockingProblems({ inbox_permission: false }).length === 0);
check("failed sends are not a red-banner problem either", blockingProblems({ failed: 5 }).length === 0);
check("sms permission and monitoring are red-banner problems", blockingProblems({ sms_permission: false, monitoring: false }).length === 2);
check("blocking problems come first in the full list", infoProblems({ sms_permission: false, inbox_permission: false, failed: 2 })[0].startsWith("SMS permission"));
check("no report: no blocking problems", blockingProblems(null).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
