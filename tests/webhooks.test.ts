import { answerText, eventLabel, orderRef, outboxState, siteNeedsAttention, summarizeSite, summaryLine, type OutboxRow } from "../dashboard/src/lib/webhooks.ts";
import { rerunLine, rerunSummary } from "../dashboard/src/lib/rerunWords.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}
const row = (o: Partial<OutboxRow>): OutboxRow => ({
  id: 1, order_id: "11111111-2222-3333-4444-555555555555", event: "deposit.expired", created_at: "2026-11-04T10:00:00Z", attempts: 0,
  delivered_at: null, gave_up_at: null, last_status: null, next_attempt_at: null, orders: { api_key_id: "K1", merchant_order_id: "SHOP-9", order_no: "PT-1" }, ...o,
});

check("delivered", outboxState(row({ delivered_at: "2026-11-04T10:01:00Z", attempts: 1 })) === "delivered");
check("waiting before the first try", outboxState(row({})) === "waiting");
check("retrying after a failed try", outboxState(row({ attempts: 2 })) === "retrying");
check("gave up", outboxState(row({ attempts: 8, gave_up_at: "2026-11-05T10:00:00Z" })) === "gave_up");

check("400 in words", answerText("400").includes("rejected the message"));
check("405 in words", answerText("405").includes("does not accept POST"));
check("timeout in words", answerText("timeout").includes("8 seconds"));
check("200 in words", answerText("200").includes("accepted"));
check("nothing yet", answerText(null) === "not sent yet");
check("event label", eventLabel("deposit.paid") === "Paid" && eventLabel("odd.thing") === "odd.thing");
check("order ref prefers the site's own id", orderRef(row({})) === "SHOP-9");
check("order ref falls back to the order number, then the id", orderRef(row({ orders: { api_key_id: "K1", merchant_order_id: null, order_no: "PT-1" } })) === "PT-1" && orderRef(row({ orders: null })) === "11111111");

const rows = [
  row({ id: 1, delivered_at: "2026-11-04T10:01:00Z", attempts: 1 }),
  row({ id: 2, attempts: 3, last_status: "400", next_attempt_at: "2026-11-04T11:00:00Z", created_at: "2026-11-04T10:30:00Z" }),
  row({ id: 3, attempts: 8, last_status: "405", gave_up_at: "2026-11-05T10:00:00Z", created_at: "2026-11-03T10:00:00Z" }),
  row({ id: 4, orders: { api_key_id: "K2", merchant_order_id: "X", order_no: null }, attempts: 8, gave_up_at: "2026-11-05T10:00:00Z" }),
];
const s = summarizeSite(rows, "K1");
check("only this site's rows are counted", s.total === 3 && s.delivered === 1 && s.retrying === 1 && s.gaveUp === 1 && s.waiting === 0);
check("problems newest first, delivered left out", s.problems.map((r) => r.id).join(",") === "2,3");
check("needs attention", siteNeedsAttention(s) === true && siteNeedsAttention(summarizeSite([rows[0]], "K1")) === false);
check("summary line", summaryLine(s) === "Last 7 days: 1 delivered, 1 given up, 1 still trying", summaryLine(s));
check("no rows, no line", summaryLine(summarizeSite(rows, "K9")) === null);

check("rerun summary counts", rerunSummary([{ result: "stored" }, { result: "stored" }, { result: "still_unreadable" }, { result: "duplicate" }]) === "4 messages run, 2 stored now, 1 already stored, 1 still unreadable.");
check("rerun summary when nothing to do", rerunSummary([]).startsWith("Nothing to run"));
check("rerun line reads the row", rerunLine({ rerun_result: "stored", rerun_at: "2026-11-04T10:00:00Z", rerun_status: "tracked_only" })?.includes("Stored now") === true && rerunLine({ rerun_result: "stored", rerun_status: "tracked_only" })?.includes("status: tracked only") === true);
check("never re-run = no line", rerunLine({ raw: "x" }) === null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
