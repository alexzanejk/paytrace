import { commandLine, errorText, isLive, type PhoneCommand, cashInSummary, looksLikeANumber, CASH_IN_AMOUNTS, MOST_PER_CASH_IN, LEAST_PER_CASH_IN, parseCashInAmount, numberLabel, PHONE_ACTIONS, PHONE_ACTION_KINDS, isPhoneAction, actionLine, traceOf, walletScreens } from "../dashboard/src/lib/phoneCommands.ts";

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

check("queued wording", commandLine(base, money, when).startsWith("Waking the phone"));
// It must still promise the slow case: a phone the wake-up cannot reach takes it on its own 30-second beat.
check("queued wording keeps the honest worst case", commandLine(base, money, when).includes("30 seconds"));
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

check("an unexpected screen names the wallet that was asked", errorText("unexpected_screen", "bKash").startsWith("The bKash menu looked different") && errorText("unexpected_screen").startsWith("The wallet's menu"));
check("the failed line names the wallet too", commandLine({ ...base, status: "failed", error: "unexpected_screen", finished_at: "2026-11-01T10:01:00Z" }, money, when, "bKash").includes("The bKash menu"));
check("the phone's step log is told apart from the wallet's screens", traceOf(["Statement List:\n1 02/11/26 Cash In -Tk -200.00", "What the phone saw:\n 0.1s dialer opened\n 3.0s stopped: unexpected_screen [...]"]) === "0.1s dialer opened\n 3.0s stopped: unexpected_screen [...]" && JSON.stringify(walletScreens(["a", "What the phone saw:\nx"])) === JSON.stringify(["a"]));
check("no step log = nothing", traceOf(null) === null && traceOf(["Statement List:"]) === null && walletScreens(null).length === 0);

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
  assert.ok(CASH_IN_AMOUNTS.every((a) => a >= LEAST_PER_CASH_IN && a <= MOST_PER_CASH_IN));
  assert.equal(LEAST_PER_CASH_IN, 100);
  assert.equal(MOST_PER_CASH_IN, 50000);
  // An exact typed amount: commas, Bangla digits and paisa are fine; outside the bounds or junk is not.
  assert.equal(parseCashInAmount("5,000"), 5000);
  assert.equal(parseCashInAmount("৫০০০"), 5000);
  assert.equal(parseCashInAmount("2500.50"), 2500.5);
  assert.equal(parseCashInAmount("100"), 100);
  assert.equal(parseCashInAmount("50000"), 50000);
  assert.equal(parseCashInAmount("99"), null);
  assert.equal(parseCashInAmount("50001"), null);
  assert.equal(parseCashInAmount("12.345"), null);
  assert.equal(parseCashInAmount("abc"), null);
  assert.equal(parseCashInAmount(""), null);
  assert.equal(numberLabel({ id: "x", provider: "bkash", number: "01706630756", label: "Shop", enabled: true }), "Shop · 01706630756");
  assert.equal(numberLabel({ id: "x", provider: "bkash", number: "01706630756", label: null, enabled: true }), "01706630756");

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

// ---- Phone controls (2026-11-02) ----
{
  const ctl: PhoneCommand = { id: "c", kind: "restart", provider: null, status: "queued", balance: null, error: null, created_at: "2026-11-02T10:00:00Z", finished_at: null };
  // The phone's PhoneActions.KINDS names exactly these seven; another here would be queued and answered "unsupported".
  check("the seven phone controls, in this order", JSON.stringify(PHONE_ACTION_KINDS) === JSON.stringify(["restart", "inbox", "resend", "screen", "ring", "apprecord", "appread"]));
  check("every control has a button, a busy line, a done line and a why", PHONE_ACTIONS.every((a) => a.label && a.busy && a.done && a.help));
  check("wallet commands are not controls", !isPhoneAction("balance") && !isPhoneAction("cashin") && !isPhoneAction("statement") && !isPhoneAction(null));
  check("controls carry no wallet", ctl.provider === null && isPhoneAction(ctl.kind));
  check("queued control keeps the honest worst case", actionLine(ctl, when).includes("30 seconds"));
  check("running control says what the phone is doing", actionLine({ ...ctl, status: "running" }, when) === "Restarting PayTrace on the phone…");
  check("done control says so with the time", actionLine({ ...ctl, status: "done", finished_at: "2026-11-02T10:00:05Z" }, when) === "PayTrace was restarted (@2026-11-02T10:00:05Z)");
  check("failed control names the button and the reason", actionLine({ ...ctl, kind: "inbox", status: "failed", error: "inbox_unreadable", finished_at: "x" }, when).includes("\"Read inbox now\"") && actionLine({ ...ctl, kind: "inbox", status: "failed", error: "inbox_unreadable", finished_at: "x" }, when).includes("SMS permission"));
  check("expired control is explained", actionLine({ ...ctl, status: "cancelled", error: "expired", finished_at: "x" }, when).includes("offline"));
  check("a wallet command gives no control line", actionLine(base, when) === "");
}
