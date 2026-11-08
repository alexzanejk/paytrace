import { csvRows, fromCashin, fromOpenCrypto, fromTransfer, resultText, rowsFor, stageCounts, stageOf, totalsByPhone, type HistoryFilter } from "../dashboard/src/lib/jobHistory.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

const S = "phone-s", V = "phone-v";
// Shapes as the database returns them (numbers as text).
const items = [
  fromCashin({ id: "c1", device_id: S, provider: "rocket", status: "checking", balance: "28347.14", balance_at: "2026-11-08T13:29:00Z", amount: "28000.00", commission: "0.00", submitted_at: "2026-11-08T14:29:12Z", cost: "25.00", cost_note: "fund transfer fee", number: "01839410233" }),
  fromCashin({ id: "c2", device_id: V, provider: "bkash", status: "open", balance: "8404.10", balance_at: "2026-11-08T10:00:00Z", created_at: "2026-11-08T10:00:05Z", number: "01839410233" }),
  fromCashin({ id: "c3", device_id: S, provider: "rocket", status: "cancelled", note: "switched", balance_at: "2026-11-07T10:00:00Z", checked_at: "2026-11-07T12:00:00Z" }),
  fromCashin({ id: "c4", device_id: V, provider: "bkash", status: "verified", amount: "8000", commission: "32", submitted_at: "2026-11-07T08:00:00Z", checked_at: "2026-11-07T09:00:00Z", cost: "0" }),
  fromTransfer({ id: "t1", device_id: V, provider: "nagad", status: "verified", amount: "20000", charge: "82", cost: "30", cost_note: "P2P fee", since: "2026-11-06T10:00:00Z", submitted_at: "2026-11-06T11:00:00Z", checked_at: "2026-11-06T11:05:00Z" }),
  fromTransfer({ id: "t2", device_id: S, provider: "nagad", status: "rejected", amount: "500", charge: "0", submitted_at: "2026-11-08T05:00:00Z", checked_at: "2026-11-08T06:00:00Z", note: "never arrived" }),
  fromOpenCrypto({ device_id: V, provider: "nagad", balance: "23253.72", balance_at: "2026-11-08T14:44:00Z" }),
];
const all: HistoryFilter = { device: null, kind: null, from: "2026-11-01", to: "2026-11-08" };

check("statuses go to the right tab", stageOf("open") === "pending" && stageOf("shown") === "pending" && stageOf("mismatch") === "waiting" && stageOf("review") === "waiting" && stageOf("verified") === "done" && stageOf("rejected") === "closed" && stageOf("cancelled") === "closed");
const c = stageCounts(items, all);
check("counts per tab", c.pending === 2 && c.waiting === 1 && c.done === 2 && c.closed === 2, c);
check("pending holds a Taka job on the phone and a crypto job on the phone", rowsFor(items, "pending", all).map((i) => i.kind).sort().join() === "crypto,taka");
check("done is newest first", rowsFor(items, "done", all).map((i) => i.id).join() === "c4,t1");
check("the date range limits Done and Closed, never Pending or Waiting", (() => {
  const one: HistoryFilter = { ...all, from: "2026-11-08", to: "2026-11-08" };
  return rowsFor(items, "done", one).length === 0 && rowsFor(items, "closed", one).length === 1 && rowsFor(items, "pending", one).length === 2 && rowsFor(items, "waiting", one).length === 1;
})());
check("a Bangladesh day: 11:30 PM UTC on the 7th is the 8th in Dhaka", rowsFor([fromCashin({ id: "x", device_id: V, provider: "bkash", status: "verified", checked_at: "2026-11-07T23:30:00Z" })], "done", { ...all, from: "2026-11-08", to: "2026-11-08" }).length === 1);
check("phone and job-kind filters", rowsFor(items, "done", { ...all, device: S }).length === 0 && rowsFor(items, "closed", { ...all, kind: "taka" }).map((i) => i.id).join() === "c3");
const tot = totalsByPhone(rowsFor(items, "done", all));
check("done totals per phone add the sent amount, commission/charge and other cost", tot.length === 1 && tot[0].device_id === V && tot[0].jobs === 2 && tot[0].sent === 28000 && tot[0].charge === 114 && tot[0].cost === 30, tot);
check("the cost and its note are kept", items[0].cost === 25 && items[0].cost_note === "fund transfer fee");
check("a job taken off by a switch is told apart from one you cancelled", resultText(items[2]).startsWith("Taken off") && resultText(fromCashin({ id: "y", device_id: V, provider: "bkash", status: "cancelled", note: null })) === "Cancelled by you" && items[2].note === null);
check("rejected keeps your note", items[5].note === "never arrived" && resultText(items[5]) === "Rejected by you");
const csv = csvRows([items[0]], () => "SADIKUR");
check("CSV row has the phone name, the cost and what it was for", csv[0][1] === "SADIKUR" && csv[0][8] === 25 && csv[0][9] === "fund transfer fee");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
