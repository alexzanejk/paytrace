import { commandLine, errorText, isLive, type PhoneCommand, cashInSummary, looksLikeANumber, CASH_IN_AMOUNTS, MOST_PER_CASH_IN } from "../dashboard/src/lib/phoneCommands.ts";

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
check("too soon and network failure are explained", errorText("too_soon").includes("Wait about a minute") && errorText("ussd_failed").includes("did not try again"));
check("done line carries the wallet name", commandLine({ ...base, status: "done", balance: 1570.78, provider: "bkash", finished_at: "2026-11-01T10:01:00Z" }, money, when, "bKash") === "bKash balance Tk 1570.78 as of @2026-11-01T10:01:00Z");
check("provider refusal is explained", errorText("network_refused").includes("not available"));
check("unknown error code falls back", errorText("zzz") === errorText("failed"));
check("missing error code falls back", errorText(null) === errorText("failed"));
check("no command gives an empty line", commandLine(null, money, when) === "");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

test("a cash-in is described in full, so nothing is sent on a glance", () => {
  const money = (n: number) => `Tk ${n.toLocaleString("en-US")}`;
  const when = () => "2 Nov 10:00";
  assert.equal(
    cashInSummary("bKash", 5000, "01706630756", money),
    "Send Tk 5,000 from this phone's bKash wallet to 01706630756.",
  );
  assert.ok(looksLikeANumber("01706630756"));
  assert.ok(!looksLikeANumber("0170663075"));
  assert.ok(!looksLikeANumber("11706630756"));
  assert.ok(!looksLikeANumber(""));
  assert.ok(CASH_IN_AMOUNTS.every((a) => a > 0 && a <= MOST_PER_CASH_IN));

  const done: PhoneCommand = {
    id: "1", kind: "cashin", provider: "bkash", status: "done",
    balance: 2000, error: null, created_at: "x", finished_at: "x",
    amount: 5000, to_number: "01706630756", trx_id: "AB12CD34",
  };
  const line = commandLine(done, money, when, "bKash");
  assert.ok(line.includes("Sent Tk 5,000 to 01706630756"));
  assert.ok(line.includes("AB12CD34"));

  // The one that matters most: a refusal before the PIN must say that nothing moved.
  const refused: PhoneCommand = { ...done, status: "failed", error: "confirm_does_not_match", trx_id: null };
  assert.ok(commandLine(refused, money, when, "bKash").includes("NOTHING was sent"));
});
