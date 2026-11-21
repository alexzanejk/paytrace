import { historyCsv, historyLine, historySummary, type HistoryEvent } from "../dashboard/src/lib/tgHistory.ts";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean) => { if (ok) { pass++; console.log("  ok  ", name); } else { fail++; console.log("  FAIL", name); } };

const post: HistoryEvent = { at: "2026-11-20T10:00:00Z", kind: "post", status: "matched", trx: "DKK6Q54GKK", amount: 500, provider: "bkash", photo: true, reacted: true };
const l1 = historyLine(post);
check("a matched photo post names the wallet, TrxID, amount and the thumbs-up", l1.title === "posted, matched: a photo · bKash DKK6Q54GKK · Tk 500.00" && l1.detail === "👍 sent" && l1.tone === "ok");
const l2 = historyLine({ at: null, kind: "post", status: "unmatched", detail: "no TrxID in it", photo: false });
check("plain chat reads as a text with no match", l2.title === "posted, no match: a text" && l2.detail === "no TrxID in it" && l2.tone === "idle");
const l3 = historyLine({ at: null, kind: "plan_queued", status: "queued", count: 2, amount: 3300, to: "01712345678" });
check("a queued plan", l3.title === "payout queued: 2 transactions, Tk 3,300.00 to 01712345678" && l3.tone === "idle");
check("a failed plan is red with its reason", historyLine({ at: null, kind: "plan_failed", status: "failed", count: 1, amount: 500, detail: "already paid out" }).tone === "bad");
const l4 = historyLine({ at: null, kind: "payout", status: "paid", amount: 400, to: "01712345678", method: "cash_in", trx: "DKJ1X", count: 1 });
check("a paid payout", l4.title === "Paid Tk 400.00 to 01712345678 (by Cash In) · TrxID DKJ1X" && l4.detail === "1 transaction" && l4.tone === "ok");
check("a reply sent", historyLine({ at: null, kind: "reply", status: "sent", detail: "✅ @bob, …" }).title === "Notice sent in the group");
check("a reply sent privately says so", historyLine({ at: null, kind: "reply", status: "sent", where: "private", detail: "✅ …" }).title === "Notice sent privately (their inbox)");
check("a reply sent in the group says so when told", historyLine({ at: null, kind: "reply", status: "sent", where: "group", detail: "✅ …" }).title === "Notice sent in the group");
check("a reply that failed is red and says why", historyLine({ at: null, kind: "reply", status: "failed", detail: "not sent: the person has not opened the bot (group replies are off)" }).tone === "bad" && historyLine({ at: null, kind: "reply", status: "failed", detail: "x" }).title === "Notice not sent");
const csv = historyCsv([post, { at: "2026-11-20T11:00:00Z", kind: "reply", status: "sent", detail: "=HYPERLINK(\"x\")" }]);
check("csv: header, one row per event, a formula-looking cell is made safe", csv.split("\n").length === 3 && csv.includes("when,what,detail") && csv.includes("'=HYPERLINK"));
check("summary", historySummary([post, { at: null, kind: "payout", status: "paid", amount: 400 }, { at: null, kind: "post", status: "unmatched" }]) === "2 posts, 1 matched · 1 payout paid (Tk 400.00)");
const down = historyLine({ at: null, kind: "post", status: "conflict", trx: "76CQOWIY", amount: 1000, provider: "nagad", photo: true, reacted: true, react_kind: "down", warned: true });
check("a conflicting post shows the thumbs-down and the warning (migration 124)", down.detail.includes("👎 sent") && down.detail.includes("warned to delete the post") && down.tone === "warn");
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
