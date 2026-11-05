import {
  KIND_WORDS, kindLabel, isIn, SOURCE_WORDS, defaultRange, rangeProblem, groupByDay, ledgerCounts, ledgerCsv, ownMoney, recentB2BOut, parseOpening,
  type LedgerRow,
} from "../dashboard/src/lib/ledger.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

const row = (o: Partial<LedgerRow>): LedgerRow => ({
  sort_at: "2026-11-05T04:00:00+00:00", exact_time: true, day: "2026-11-05", kind: "cash_out", label: "cash_out", amount: 500, balance: 1000,
  trx_id: "T1", status: "tracked_only", review_reason: null, chain_status: "ok", source: "sms", raw: "", payment_id: "p", sim_slot: 0, counterparty: null, ...o,
});

// ---- words ----
check("every kind has words and a direction", Object.values(KIND_WORDS).every((w) => w.label.length > 3 && typeof w.in === "boolean"));
check("a B2B out is money out, a customer's Cash Out is money in", !KIND_WORDS.b2b_out.in && KIND_WORDS.cash_out.in);
check("an unknown kind falls back to the wallet's words", kindLabel("weird_thing", "Agent Cash Out") === "Agent Cash Out" && kindLabel("weird_thing") === "weird thing");
check("direction of an unknown kind follows the sign", isIn("weird_thing", -5) === false && isIn("weird_thing", 5) === true);
check("source words", SOURCE_WORDS.statement.includes("no SMS") && SOURCE_WORDS.both.includes("statement"));

// ---- range ----
const r = defaultRange(new Date("2026-11-05T20:00:00Z")); // 02:00 on 06 Nov in Dhaka
check("default range is the Dhaka day and the two before it", r.from === "2026-11-04" && r.to === "2026-11-06", r);
check("a window over 31 days is refused", rangeProblem("2026-01-01", "2026-02-05") !== null && rangeProblem("2026-01-01", "2026-01-31") === null);
check("end before start is refused", rangeProblem("2026-01-05", "2026-01-01") !== null);
check("a missing date is refused", rangeProblem("", "2026-01-01") !== null);

// ---- grouping ----
const rows = [
  row({ sort_at: "2026-11-04T05:00:00+00:00", day: "2026-11-04", amount: 500 }),
  row({ sort_at: "2026-11-05T05:00:00+00:00", day: "2026-11-05", amount: 700, source: "both" }),
  row({ sort_at: "2026-11-05T06:00:00+00:00", day: "2026-11-05", kind: "b2b_out", label: "B2B Transfer", amount: -8000, source: "statement", exact_time: false, trx_id: null, balance: null }),
  row({ sort_at: "2026-11-05T03:00:00+00:00", day: "2026-11-05", amount: 300, source: "statement", exact_time: false }),
];
const g = groupByDay(rows);
check("newest day first", g[0].day === "2026-11-05" && g[1].day === "2026-11-04");
check("newest row first inside a day", g[0].rows.map((x) => x.amount).join() === "-8000,700,300");
check("day totals in and out", g[0].in === 1000 && g[0].out === 8000);
check("counts by source", JSON.stringify(ledgerCounts(rows)) === JSON.stringify({ smsOnly: 1, both: 1, statementOnly: 2 }));

// ---- csv ----
const csv = ledgerCsv(rows.slice(0, 1));
check("csv header + one row", csv.length === 2 && csv[0][0] === "Time (Dhaka)" && csv[1][4] === 500 && csv[1][9] === "SIM 1");
const csvStmt = ledgerCsv([rows[2]]);
check("a statement-only row says so in the csv", csvStmt[1][1] === "between neighbours" && csvStmt[1][3] === "B2B Transfer" && csvStmt[1][8] === SOURCE_WORDS.statement);

// ---- float ----
check("own money = balance - float", ownMoney(20000, 6000) === 14000 && ownMoney(null, 6000) === null && ownMoney("100.50", "0.25") === 100.25);
const f = { device_id: "d", provider: "bkash", opening: 0, opening_at: null, b2b_in: 0, b2b_out: 7000, float: -7000, last_out_at: "2026-11-05T05:00:00Z", last_out_amount: 7000, last_in_at: null };
check("a B2B out in the last 24 h is flagged", recentB2BOut(f, Date.parse("2026-11-05T20:00:00Z")) && !recentB2BOut(f, Date.parse("2026-11-07T20:00:00Z")) && !recentB2BOut(undefined));
check("opening amount parsing", parseOpening("10,000") === 10000 && parseOpening("\u09e7\u09e6\u09e6") === 100 && parseOpening("12.5") === 12.5 && parseOpening("-1") === null && parseOpening("abc") === null && parseOpening("99999999") === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
