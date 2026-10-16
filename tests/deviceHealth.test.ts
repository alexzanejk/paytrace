import {
  agoText, deviceHealth, infoProblems, LATE_AFTER_MIN, minutesSince, SILENT_AFTER_MIN,
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

check("5 min ago is online", h(ago(5)).level === "online");
check("just under the late line is online", h(ago(LATE_AFTER_MIN - 1)).level === "online");
check("at the late line is late", h(ago(LATE_AFTER_MIN)).level === "late");
check("just under the silent line is late", h(ago(SILENT_AFTER_MIN - 1)).level === "late");
check("at the silent line is silent", h(ago(SILENT_AFTER_MIN)).level === "silent");
check("two days ago is silent", h(ago(2880)).level === "silent");

// the server's watchdog and this page must agree on when a phone is "silent"
const server = readFileSync(new URL("../supabase/functions/ingest/index.ts", import.meta.url), "utf8");
const serverLine = Number(server.match(/const SILENT_AFTER_MIN = (\d+);/)?.[1]);
check("dashboard and Telegram agree on the silent line", serverLine === SILENT_AFTER_MIN, { serverLine, SILENT_AFTER_MIN });

// never spoke: judged from approval
check("never spoke, approved 3 min ago: fine", h(null, ago(3)).level === "online" && h(null, ago(3)).neverSpoke);
check("never spoke, approved 5 hours ago: silent", h(null, ago(300)).level === "silent");

// a browser clock a little behind the server
check("future timestamp is clamped, not negative", (minutesSince(new Date(NOW + 120000).toISOString(), NOW) ?? -1) === 0);
check("junk timestamp is unknown", minutesSince("not a date", NOW) === null);

check("ago: just now", agoText(0.2) === "just now");
check("ago: minutes", agoText(12) === "12 min ago");
check("ago: hours and minutes", agoText(125) === "2 h 5 min ago");
check("ago: whole hours", agoText(120) === "2 h ago");
check("ago: days", agoText(1500) === "1 d 1 h ago");
check("ago: never", agoText(null) === "never");

check("healthy report has no problems", infoProblems({ monitoring: true, sms_permission: true, failed: 0 }).length === 0);
check("no report has no problems", infoProblems(null).length === 0 && infoProblems(undefined).length === 0);
check("sms permission off is flagged", infoProblems({ sms_permission: false }).some((p) => /SMS permission/.test(p)));
check("monitoring off is flagged", infoProblems({ monitoring: false }).some((p) => /not being forwarded/.test(p)));
check("failed sends are counted, singular", infoProblems({ failed: 1 })[0] === "1 message could not be sent");
check("failed sends are counted, plural", infoProblems({ failed: 4 })[0] === "4 messages could not be sent");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
