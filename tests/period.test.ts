import {
  addDays, dayStartIso, groupSummary, isCounted, periodRange, rangeBounds, rangeLabel, summarize, type DayTotal,
} from "../dashboard/src/lib/period.ts";
import { csvCell, toCsv } from "../dashboard/src/lib/csv.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

// ---- days are Bangladesh calendar days ----
check("addDays forward over a month end", addDays("2026-10-31", 1) === "2026-11-01");
check("addDays back over a year start", addDays("2026-01-01", -1) === "2025-12-31");
check("a day starts at 00:00 +06:00 (= 18:00 UTC the day before)", dayStartIso("2026-10-18") === "2026-10-17T18:00:00.000Z");

// 23:30 UTC on 17 Oct is already 05:30 on 18 Oct in Bangladesh.
const lateUtc = new Date("2026-10-17T23:30:00Z");
check("today follows Bangladesh time, not the viewer's", periodRange("today", { from: "", to: "" }, lateUtc).from === "2026-10-18");
check("yesterday", periodRange("yesterday", { from: "", to: "" }, lateUtc).to === "2026-10-17");
const w = periodRange("7d", { from: "", to: "" }, lateUtc);
check("last 7 days is seven days including today", w.from === "2026-10-12" && w.to === "2026-10-18", w);
const m = periodRange("30d", { from: "", to: "" }, lateUtc);
check("last 30 days", m.from === "2026-09-19" && m.to === "2026-10-18", m);
const swapped = periodRange("custom", { from: "2026-10-05", to: "2026-10-01" });
check("custom dates typed backwards are put in order", swapped.from === "2026-10-01" && swapped.to === "2026-10-05", swapped);
check("custom with only a start is one day", periodRange("custom", { from: "2026-10-05", to: "" }).to === "2026-10-05");

const b = rangeBounds({ from: "2026-10-18", to: "2026-10-18" });
check("a one-day range is exactly 24 hours", new Date(b.endIso).getTime() - new Date(b.startIso).getTime() === 864e5, b);
check("label for one day and for a span", rangeLabel({ from: "2026-10-18", to: "2026-10-18" }) === "18 Oct 2026" && rangeLabel({ from: "2026-10-12", to: "2026-10-18" }) === "12 Oct 2026 – 18 Oct 2026");

// ---- totals ----
const row = (o: Partial<DayTotal>): DayTotal => ({
  day: "2026-10-18", device_id: "d1", provider: "bkash", txn_type: "payment_received", status: "matched",
  n: 1, amount: 100, fee: 0, commission: 0, ...o,
});
const rows: DayTotal[] = [
  row({ n: 2, amount: 300 }),
  row({ txn_type: "send_money_received", status: "unmatched", n: 1, amount: 50 }),
  row({ txn_type: "cash_out", status: "tracked_only", n: 3, amount: 1000, fee: 5, commission: 4.5 }),
  row({ status: "review", amount: 9999 }), // could be a fake SMS: never counted
  row({ status: "ignored", amount: 7777 }),
  row({ device_id: "d2", provider: "nagad", txn_type: "cash_out", status: "tracked_only", n: 1, amount: 200, commission: 0.8 }),
];
const s = summarize(rows);
check("received = payments + send money, counted statuses only", s.received.amount === 350 && s.received.n === 3, s.received);
check("cash out summed across phones", s.cashOut.amount === 1200 && s.cashOut.n === 4, s.cashOut);
check("commission summed", Math.abs(s.commission - 5.3) < 1e-9, s.commission);
check("review and ignored are not counted", !isCounted("review") && !isCounted("ignored") && isCounted("tracked_only"));

const per = groupSummary(rows, (r) => r.device_id ?? "none");
check("totals per phone", per.get("d1")!.cashOut.amount === 1000 && per.get("d2")!.cashOut.amount === 200);
check("a phone with only held payments totals zero", groupSummary([row({ status: "review" })], (r) => r.device_id!).get("d1")!.received.n === 0);
check("numbers sent as strings are still added", summarize([row({ amount: "12.50" as unknown as number })]).received.amount === 12.5);

// ---- CSV is safe to open in a spreadsheet ----
check("formula text is neutralised", csvCell("=SUM(A1)") === "'=SUM(A1)");
check("plus, minus and at are neutralised", csvCell("+88017").startsWith("'") && csvCell("@x").startsWith("'"));
check("commas and quotes are quoted", csvCell('a,"b"') === '"a,""b"""');
check("plain numbers stay plain", csvCell(1250.5) === "1250.5");
check("rows are joined with CRLF", toCsv(["a", "b"], [[1, 2]]) === "a,b\r\n1,2");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
