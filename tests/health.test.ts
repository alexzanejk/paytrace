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
check("a missing inbox permission is NOT a Telegram alert (it only shows on the dashboard)", healthProblem({ monitoring: true, sms_permission: true, inbox_permission: false }) === null);

check("healthy phone has no problem", healthProblem({ monitoring: true, sms_permission: true }) === null);
check("monitoring off is a problem", healthProblem({ monitoring: false, sms_permission: true }) === "monitoring_off");
check("sms permission off is a problem", healthProblem({ monitoring: true, sms_permission: false }) === "sms_permission_off");
check("permission outranks the switch", healthProblem({ monitoring: false, sms_permission: false }) === "sms_permission_off");
check("unknown values are not treated as problems", healthProblem({}) === null && healthProblem(null) === null && healthProblem(undefined) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
