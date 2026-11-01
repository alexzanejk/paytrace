import { commandLine, errorText, isLive, type PhoneCommand } from "../dashboard/src/lib/phoneCommands.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

const base: PhoneCommand = { id: "x", kind: "balance", provider: "nagad", status: "queued", balance: null, error: null, created_at: "2026-11-01T10:00:00Z", finished_at: null };
const money = (n: number) => `Tk ${n.toFixed(2)}`;
const when = (t: string) => `@${t}`;

check("queued and running are live", isLive(base) && isLive({ ...base, status: "running" }));
check("done, failed and cancelled are not live", !isLive({ ...base, status: "done" }) && !isLive({ ...base, status: "failed" }) && !isLive({ ...base, status: "cancelled" }));
check("no command is not live", !isLive(null));

check("queued wording", commandLine(base, money, when).startsWith("Waiting for the phone"));
check("running wording", commandLine({ ...base, status: "running" }, money, when).includes("reading the balance"));
check("done shows the balance and time", commandLine({ ...base, status: "done", balance: 17200.42, finished_at: "2026-11-01T10:01:00Z" }, money, when) === "Nagad balance Tk 17200.42 as of @2026-11-01T10:01:00Z");
check("failed shows the reason", commandLine({ ...base, status: "failed", error: "unexpected_screen", finished_at: "2026-11-01T10:01:00Z" }, money, when).includes("Nothing was sent"));
check("expired is explained", errorText("expired").includes("offline"));
check("no answer after the PIN is explained and not retried", errorText("no_answer_after_pin").includes("did not try the PIN again"));
check("unknown error code falls back", errorText("zzz") === errorText("failed"));
check("missing error code falls back", errorText(null) === errorText("failed"));
check("no command gives an empty line", commandLine(null, money, when) === "");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
