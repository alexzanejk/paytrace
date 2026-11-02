import {
  readRow, readList, readDetail, unreadLines, looksLikeAList, matchRow, statementDay, statementSummary,
  type RowMatch,
} from "../dashboard/src/lib/statement.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

// The owner's real bKash agent statement (2026-11-02), word for word.
const page1 = [
  "Statement List:",
  "1 02/11/26 Cash In -Tk -200.00",
  "2 29/10/26 Cash Out -Tk 500.00",
  "3 28/10/26 Cash Out -Tk 500.00",
  "4 28/10/26 Cash Out -Tk 500.00",
  "# NEXT",
].join("\n");
const page2 = [
  "5 28/10/26 B2B Transfer -Tk -5000.00",
  "6 27/10/26 B2B Transfer -Tk 5000.00",
  "00 BACK",
].join("\n");
const detail = [
  "Cash In Tk -200.00",
  "Fee Tk 0.00",
  "From 01706630756",
  "To 01846632612",
  "TrxID DK29URXBHB",
  "At 02/11/2026 06:24:45",
].join("\n");

// ---- one line of the list ----
const first = readRow("1 02/11/26 Cash In -Tk -200.00")!;
check("entry number", first.no === 1, first);
check("date as the wallet wrote it", first.date === "02/11/26", first);
check("kind", first.type === "Cash In", first);
check("money the agent paid out is negative", first.amount === -200, first);
check("the whole line is kept", first.raw === "1 02/11/26 Cash In -Tk -200.00", first);

const cashOut = readRow("2 29/10/26 Cash Out -Tk 500.00")!;
check("money that came in is positive", cashOut.type === "Cash Out" && cashOut.amount === 500, cashOut);

const b2b = readRow("5 28/10/26 B2B Transfer -Tk -5000.00")!;
check("a two-word kind with a sign", b2b.type === "B2B Transfer" && b2b.amount === -5000, b2b);

check("the heading is not an entry", readRow("Statement List:") === null);
check("the paging line is not an entry", readRow("# NEXT") === null);
check("the back line is not an entry", readRow("00 BACK") === null);
check("a detail line is not an entry", readRow("TrxID DK29URXBHB") === null);

// ---- the whole list, across pages ----
const rows = readList([page1, page2]);
check("every entry from both pages", rows.length === 6, rows.map((r) => r.no));
check("in the wallet's own order", rows.map((r) => r.no).join(",") === "1,2,3,4,5,6");
check("a page sent twice does not double up", readList([page1, page1, page2]).length === 6);
check("a list is recognised as one", looksLikeAList([page1]));
check("one entry's screen is not a list", !looksLikeAList([detail]));
check("nothing is read out of nothing", readList(null).length === 0 && readList([]).length === 0);

// Nothing is silently dropped: a line the reading cannot place is handed back.
check("known furniture is not reported as unread", unreadLines([page1, page2]).length === 0, unreadLines([page1, page2]));
check("an odd line is reported", unreadLines(["7 something the wallet made up"]).length === 1);

// ---- one entry ----
const d = readDetail(detail)!;
check("detail kind", d.type === "Cash In", d);
check("detail amount", d.amount === -200, d);
check("detail fee", d.fee === 0, d);
check("detail from", d.from === "01706630756", d);
check("detail to", d.to === "01846632612", d);
check("detail receipt number", d.trxId === "DK29URXBHB", d);
check("detail time", d.at === "02/11/2026 06:24:45", d);
check("the raw screen is kept", d.raw === detail);
check("nothing in, nothing out", readDetail("") === null && readDetail(null) === null);
// A wallet PayTrace has never seen still comes back, with its words intact.
const unknown = readDetail("Something new\nNo fields we know")!;
check("an unknown screen keeps its text", unknown.raw.includes("Something new") && unknown.trxId === null);
// "To" must not latch on to a word that merely starts with it.
check("'Total' is not the 'To' field", readDetail("Cash Out Tk 500.00\nTotal 900")!.to === null);

// ---- days ----
check("day first, two-digit year", statementDay("02/11/26") === "2026-11-02");
check("four-digit year too", statementDay("28/10/2026") === "2026-10-28");
check("a date that cannot be one", statementDay("45/99/26") === null && statementDay("hello") === null);

// ---- which transactions PayTrace never received ----
const dayOf = (iso: string) => iso.slice(0, 10);
const stored = [
  { trx_id: "A1", amount: 500, occurred_at: "2026-10-29T12:00:00+06:00", created_at: "2026-10-29T12:00:00+06:00" },
];
const list = readList([page1, page2]);
const matches: RowMatch[] = list.map((r) => matchRow(r, stored, dayOf));
check("a Cash Out we hold is 'have'", matches[1] === "have", matches);
check("a Cash Out we never received is 'missing'", matches[2] === "missing" && matches[3] === "missing", matches);
check("a Cash In the agent paid out is not expected as an SMS", matches[0] === "unknown", matches);
check("a B2B transfer is not expected either", matches[4] === "unknown" && matches[5] === "unknown", matches);
// The same amount on a different day is not the same transaction.
const otherDay = [{ trx_id: "B2", amount: 500, occurred_at: "2026-09-01T12:00:00+06:00", created_at: "2026-09-01T12:00:00+06:00" }];
check("same amount, wrong day, still missing", matchRow(list[1], otherDay, dayOf) === "missing");
// A payment with no stated time is judged by when it was stored.
const noTime = [{ trx_id: "C3", amount: 500, occurred_at: null, created_at: "2026-10-29T12:00:00+06:00" }];
check("a payment with no stated time still counts", matchRow(list[1], noTime, dayOf) === "have");

check("summary names what is missing", statementSummary(list, matches).includes("2 Cash Out are MISSING"), statementSummary(list, matches));
const allThere: RowMatch[] = list.map(() => "have");
check("summary when nothing is missing", statementSummary(list, allThere).includes("has every Cash Out"));
check("summary of an empty statement", statementSummary([], []).includes("no transactions"));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
