import { floatWarning, gapChoices, gapIsIn, gapLine, gapStatus, heldBack, kindWord, openGapsOf, ownMoneyOf, type GapRow } from "../dashboard/src/lib/gaps.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

const gap = (o: Partial<GapRow>): GapRow => ({
  id: "g1", device_id: "d1", provider: "bkash", sim_slot: 0, payment_id: "p1", at: "2026-11-07T05:23:29Z", prev_at: "2026-11-07T04:09:02Z",
  amount: 7002, tolerance: 10, prev_balance: 4092.17, new_balance: 11594.17, explained_by: null, explained_kind: null, explained_at: null, command_id: null, note: null, ...o,
});

// ---- held back / own money ----
check("reserved from the view wins", heldBack({ float: -7000, pending_in: 0, reserved: 123 }) === 123);
check("without reserved: float never below zero, plus unexplained ins", heldBack({ float: -7000, pending_in: 7002 }) === 7002 && heldBack({ float: 7000, pending_in: 403.83 }) === 7403.83);
check("own money = balance - held back", ownMoneyOf(2625.07, { float: -7000, pending_in: 0, reserved: 0 }) === 2625.07 && ownMoneyOf(null, undefined) === null);
check("rubel's case: 7,002 unexplained is not your money", ownMoneyOf(11594.17, { float: 0, pending_in: 7002, reserved: 7002 }) === 4592.17);

// ---- the negative float warning ----
check("a negative float warns and names the missed amount", (floatWarning({ float: -7000 }) ?? "").includes("7,000.00") && (floatWarning({ float: -7000 }) ?? "").includes("missed"));
check("a float of zero or more does not warn", floatWarning({ float: 0 }) === null && floatWarning({ float: 7000 }) === null && floatWarning(undefined) === null);

// ---- words ----
const g = gap({});
check("direction", gapIsIn(g) && !gapIsIn(gap({ amount: -4858 })));
const line = gapLine(g);
check("an in-gap on a bKash receipt reads as about, with the window and both balances", line.startsWith("about Tk 7,002.00 came into this wallet with no SMS between ") && line.includes("4,092.17") && line.includes("11,594.17"), line);
check("an exact out-gap reads without about", gapLine(gap({ amount: -4858, tolerance: 0.01 })).startsWith("Tk 4,858.00 left this wallet with no SMS"));
check("status: asked the statement", gapStatus(gap({ command_id: "c" })).includes("asked the wallet's statement"));
check("status: unexplained in is held back", gapStatus(g).includes("Held back") && gapStatus(gap({ amount: -5 })).includes("Not explained"));
check("status: explained by statement / owner", gapStatus(gap({ explained_by: "statement", explained_kind: "b2b_in" })).includes("B2B from the distributor") && gapStatus(gap({ explained_by: "owner", explained_kind: "own" })).includes("your own money"));
check("kind words fall back to the code", kindWord("weird_kind") === "weird kind" && kindWord(null) === "unknown");
check("choices follow the direction", gapChoices(g).map((c) => c.kind).join(",") === "b2b_in,cash_in_received,own,other" && gapChoices(gap({ amount: -1 }))[0]!.kind === "b2b_out");

// ---- filter ----
const all = [gap({ id: "a", at: "2026-11-07T05:00:00Z" }), gap({ id: "b", at: "2026-11-07T06:00:00Z" }), gap({ id: "c", explained_by: "owner" }), gap({ id: "d", provider: "nagad" }), gap({ id: "e", device_id: "d2" })];
check("open gaps of one wallet, newest first", openGapsOf(all, "d1", "bkash").map((x) => x.id).join(",") === "b,a");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
