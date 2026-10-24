import { cleanInfo, healthProblem } from "../supabase/functions/ingest/health.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

const at = new Date("2026-10-16T12:00:00Z");
let i = cleanInfo({ battery: 81, monitoring: true, sms_permission: true, pending: 2, failed: 0, app_version: "1.0.7" }, at);
check("normal heartbeat is kept", i.battery === 81 && i.monitoring === true && i.sms_permission === true && i.pending === 2 && i.failed === 0 && i.app_version === "1.0.7", i);
check("server stamps the report time", i.reported_at === "2026-10-16T12:00:00.000Z");

// The GET setting sends everything as text.
i = cleanInfo({ battery: "55", monitoring: "false", sms_permission: "true", pending: "3", failed: "1" }, at);
check("text values are understood", i.battery === 55 && i.monitoring === false && i.sms_permission === true && i.pending === 3 && i.failed === 1, i);

i = cleanInfo({ battery: 400, pending: -5, failed: "lots", monitoring: "maybe" }, at);
check("battery is capped at 100", i.battery === 100);
check("negative and non-numeric counts are dropped", i.pending === undefined && i.failed === undefined);
check("an unclear on/off is left unknown, not guessed", i.monitoring === undefined);

i = cleanInfo({ battery: 50, is_admin: true, __proto__: { x: 1 }, secret: "abc", raw_message: "Tk 1" } as Record<string, unknown>, at);
check("unknown fields are dropped", !("is_admin" in i) && !("secret" in i) && !("raw_message" in i), i);

i = cleanInfo({ app_version: "1.0.7<script>alert(1)</script>".repeat(5) }, at);
check("version is stripped to safe characters and capped", /^[0-9A-Za-z._-]{1,20}$/.test(i.app_version ?? ""), i.app_version);
check("a version of only junk is dropped", cleanInfo({ app_version: "<<>>" }, at).app_version === undefined);

i = cleanInfo({ inbox_permission: false, recovered: 7 }, at);
check("inbox permission and the recovered count are kept", i.inbox_permission === false && i.recovered === 7, i);
i = cleanInfo({ inbox_permission: "true", recovered: "3" }, at);
check("...also when sent as text", i.inbox_permission === true && i.recovered === 3, i);
check("a negative recovered count is dropped", cleanInfo({ recovered: -2 }, at).recovered === undefined);
i = cleanInfo({ notifications: false, battery_exempt: "false", setup_complete: true }, at);
check("setup fields are kept, also as text", i.notifications === false && i.battery_exempt === false && i.setup_complete === true, i);
check("junk setup fields are dropped", cleanInfo({ notifications: "maybe", setup_complete: 1 }, at).notifications === undefined && cleanInfo({ setup_complete: 1 }, at).setup_complete === undefined);
check("battery saver or notifications off is NOT a Telegram alert (dashboard only)", healthProblem({ battery_exempt: false, notifications: false }) === null);
i = cleanInfo({ stopped_count: 3, last_gap_min: "47" }, at);
check("stop count and gap length are kept", i.stopped_count === 3 && i.last_gap_min === 47, i);
check("junk stop counts are dropped", cleanInfo({ stopped_count: -1, last_gap_min: "x" }, at).stopped_count === undefined);
check("being stopped by the phone is NOT a Telegram alert (the offline alert covers it)", healthProblem({ stopped_count: 5 }) === null);
i = cleanInfo({ keepalive_test: "pass", keepalive_test_at: at.getTime() - 60000, keepalive_gap_s: 31 }, at);
check("screen-off test result is kept", i.keepalive_test === "pass" && i.keepalive_gap_s === 31 && typeof i.keepalive_test_at === "string", i);
check("an unknown test result is dropped", cleanInfo({ keepalive_test: "maybe", keepalive_gap_s: 5 }, at).keepalive_test === undefined && cleanInfo({ keepalive_test: "maybe", keepalive_gap_s: 5 }, at).keepalive_gap_s === undefined);
check("a test result with a silly time keeps the result but not the time", (() => { const r = cleanInfo({ keepalive_test: "fail", keepalive_test_at: 5 }, at); return r.keepalive_test === "fail" && r.keepalive_test_at === undefined; })());
i = cleanInfo({ default_sms: true }, at);
check("SMS app mode flag is kept", i.default_sms === true, i);
check("junk SMS app mode flag is dropped", cleanInfo({ default_sms: "perhaps" }, at).default_sms === undefined);
check("a missing inbox permission is NOT a Telegram alert (it only shows on the dashboard)", healthProblem({ monitoring: true, sms_permission: true, inbox_permission: false }) === null);

check("healthy phone has no problem", healthProblem({ monitoring: true, sms_permission: true }) === null);
check("monitoring off is a problem", healthProblem({ monitoring: false, sms_permission: true }) === "monitoring_off");
check("sms permission off is a problem", healthProblem({ monitoring: true, sms_permission: false }) === "sms_permission_off");
check("permission outranks the switch", healthProblem({ monitoring: false, sms_permission: false }) === "sms_permission_off");
check("unknown values are not treated as problems", healthProblem({}) === null && healthProblem(null) === null && healthProblem(undefined) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
