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

// The owner's REAL Nagad agent statement (first seen 2026-11-04 on the Vivo): a dot after the number, no decimals, the sign on the amount.
const nagad = ["Statement List\n1. 04/11/26 Cash Out Tk 500\n2. 04/11/26 Commission(Cash Out) Tk 2.05\n3. 04/11/26 B2B Tk -8000\n4. 04/11/26 Cash Out Tk 500\nNext Page *"];
const nl = readStatementLines(nagad);
check("nagad list: four entries", nl.length === 4, nl);
check("nagad Cash Out Tk 500 is money in on 2026-11-04", nl[0].in && nl[0].amount === 500 && nl[0].day === "2026-11-04" && nl[0].type === "Cash Out");
check("nagad B2B Tk -8000 is money out", nl[2].in === false && nl[2].amount === 8000 && nl[2].type === "B2B");
check("nagad commission line read as is", nl[1].amount === 2.05 && nl[1].type === "Commission(Cash Out)");
check("two Tk 500 entries, as the judge needs to count them", nl.filter((l) => l.in && l.amount === 500).length === 2);
const nd = readList(nagad);
check("dashboard reads the nagad list the same way", nd.length === 4 && nd.every((r, i) => statementDay(r.date) === nl[i].day && Math.abs(r.amount) === nl[i].amount && (r.amount >= 0) === nl[i].in));

// Paging (migration 069): bKash numbers its pages on (5, 6, ...); a wallet that starts each page at 1 again must not
// lose its second page.
const twoPages = ["1. 04/11/26 Cash Out Tk 500\n2. 04/11/26 B2B Tk -8000\nNext Page *", "1. 03/11/26 Cash In Tk -3000\n2. 03/11/26 Cash Out Tk 500"];
const tp = readStatementLines(twoPages);
check("a page numbered from 1 again carries on (3, 4)", tp.length === 4 && tp[2].no === 3 && tp[2].day === "2026-11-03" && tp[3].no === 4, tp);
const tpd = readList(twoPages);
check("the dashboard numbers them the same way", tpd.length === 4 && tpd.map((r) => r.no).join(",") === "1,2,3,4");
check("bKash's own numbering is kept", readStatementLines(screens).map((l) => l.no).join(",") === "1,2,3,4,5");
check("the same page twice is still read once", readStatementLines([nagad[0], nagad[0]]).length === 4);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
