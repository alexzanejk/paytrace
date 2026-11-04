import { readStatementLines } from "../supabase/functions/ingest/statement.ts";
import { readList, statementDay } from "../dashboard/src/lib/statement.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

const screens = [
  "Statement List:\n1 02/11/26 Cash In -Tk -200.00\n2 29/10/26 Cash Out -Tk 500.00\n3 29/10/26 B2B Transfer -Tk -7,000.00\n4 04/11/26 Cash Out -Tk 1,000.50\n# NEXT",
  "Statement List:\n5 04/11/26 Cash Out -Tk 500.00\njunk line\n00 BACK",
];
const lines = readStatementLines(screens);
check("five entries read, junk skipped", lines.length === 5, lines);
check("a customer's Cash Out is money in", lines[1].in === true && lines[1].amount === 500 && lines[1].day === "2026-10-29");
check("the agent's Cash In is money out, amount kept positive", lines[0].in === false && lines[0].amount === 200);
check("thousands separators read", lines[2].amount === 7000 && lines[2].in === false && lines[3].amount === 1000.5);
const dash = readList(screens);
check("server and dashboard read the same entries", dash.length === lines.length && dash.every((r, i) => statementDay(r.date) === lines[i].day && Math.abs(r.amount) === lines[i].amount && (r.amount >= 0) === lines[i].in));
check("nothing readable gives an empty list", readStatementLines(["Balance: Tk 100"]).length === 0 && readStatementLines(null).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
