import { readFileSync } from "node:fs";
import {
  checkNumbers, feeLine, groupDigits, parseFee, liveItemsByPayment, parsePct, payoutLine, payoutRefusal, recentNumbers, sendMethod, sendProblem, senderOptions, splitPayout,
  type PayoutRow,
} from "../dashboard/src/lib/payouts.ts";
import { accountTitle, checkLine, figures, sourceLine, type DayMoneyRow } from "../dashboard/src/lib/dayMoney.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

// ---- the split is the database's (live test 2026-11-08: 800 at 20% sent 640 kept 160; 497 at 20% kept 100 sent 397) ----
check("800 at 20% sends 640 and keeps 160", JSON.stringify(splitPayout(800, 20)) === JSON.stringify({ keep: 160, send: 640, fee: 0 }));
check("497 at 20% sends whole taka 397 and keeps 100", JSON.stringify(splitPayout(497, 20)) === JSON.stringify({ keep: 100, send: 397, fee: 0 }));
check("500 at 20% is the owner's example: 400 sent", splitPayout(500, 20).send === 400);
check("0% sends all, 100% sends nothing", splitPayout(600, 0).send === 600 && splitPayout(600, 100).send === 0);
const sql = readFileSync(new URL("../supabase/migrations/20261108_065_payouts.sql", import.meta.url), "utf8");
check("the database rounds the same way (floor of total minus kept share)", sql.includes("floor(p_total - round(p_total * p_keep_pct / 100, 2))"));

// The bKash Send Money fee comes off what is sent, never off the share kept (owner 2026-11-08).
check("1000 at 20% with a Tk 10 fee: Tk 200 kept, Tk 10 set aside, Tk 790 sent", JSON.stringify(splitPayout(1000, 20, 10)) === JSON.stringify({ keep: 200, send: 790, fee: 10 }));
check("the fee never touches the share kept (497 at 20%, fee 10: kept 100, sent 387)", JSON.stringify(splitPayout(497, 20, 10)) === JSON.stringify({ keep: 100, send: 387, fee: 10 }));
const sql67 = readFileSync(new URL("../supabase/migrations/20261108_067_send_money_fee.sql", import.meta.url), "utf8");
check("the database takes the fee off the same way", sql67.includes("v_send := floor(v_total - round(v_total * p_keep_pct / 100, 2) - v_fee);"));
check("fee: 10, 5.5 and 0 read; junk and over 500 refused", parseFee("10") === 10 && parseFee("Tk 5.5") === 5.5 && parseFee("0") === 0 && parseFee("600") === null && parseFee("x") === null);
check("fee line: still waiting for the SMS", feeLine(10, null).startsWith("Tk 10 set aside"));
check("fee line: exact", feeLine(10, 10) === "bKash fee Tk 10, exactly what was set aside");
check("fee line: a Priyo number cost nothing, so the set-aside stays with you", feeLine(10, 0).includes("Tk 10 stays with you"));
check("fee line: bKash charged more", feeLine(5, 10).includes("Tk 5 more came out of the wallet"));
check("no fee line on an agent cash-in", feeLine(0, null) === "");
check("keep share: 20, 12.5 and 100 read; junk and over 100 refused", parsePct("20") === 20 && parsePct("12.5%") === 12.5 && parsePct("100") === 100 && parsePct("101") === null && parsePct("x") === null && parsePct("") === null);

// ---- the typed number ----
check("number grouped for reading back", groupDigits("01612667190") === "0161 266 7190");
check("number typed twice, +880 form accepted", checkNumbers("+880 1612-667190", "01612667190").number === "01612667190");
check("a typo between the two is caught", checkNumbers("01612667190", "01612667191").problem.includes("not the same"));
check("a short number is refused", checkNumbers("0161266719", "0161266719").problem.includes("not a Bangladesh mobile number"));
check("the second box must be filled", checkNumbers("01612667190", "").problem.includes("second time"));

// ---- what can be paid out ----
const pay = (o: Partial<{ id: string; txn_type: string; status: string; chain_status: string | null; review_reason: string | null }>) =>
  ({ id: "p1", txn_type: "cash_out", status: "tracked_only", chain_status: "ok", review_reason: null, ...o });
const none = new Set<string>();
check("a customer's cash-out can be paid out", payoutRefusal(pay({}), none) === null);
check("send money received can be paid out", payoutRefusal(pay({ txn_type: "send_money_received", status: "unmatched" }), none) === null);
check("a possible fake (chain hold) cannot", payoutRefusal(pay({ status: "review", review_reason: "balance_chain_mismatch", chain_status: "mismatch" }), none) === "Held for review");
check("a wrong-amount hold with a sound chain is real money and can", payoutRefusal(pay({ status: "review", review_reason: "amount_mismatch: received 490.00 expected 500.00" }), none) === null);
check("money the agent sent out cannot", payoutRefusal(pay({ txn_type: "unknown", status: "ignored", review_reason: "cash_in_sent" }), none) === "Not money received");
check("not yours cannot", payoutRefusal(pay({ status: "ignored", review_reason: "not_ours" }), none) === "Not one of this phone's wallets");
check("already in a live payout cannot", payoutRefusal(pay({}), new Set(["p1"])) === "Already paid out");
const live = liveItemsByPayment([{ payout_id: "a", payment_id: "p1", amount: 1, live: false }, { payout_id: "b", payment_id: "p1", amount: 1, live: true }, { payout_id: "c", payment_id: "p2", amount: 1, live: false }]);
check("a failed payout frees its transaction; the live one counts", live.get("p1") === "b" && !live.has("p2"));

// ---- limits per send ----
check("under 100 refused, 100 to 50,000 fine, over refused, by hand anything", sendProblem(80, "cash_in").includes("under") && sendProblem(100, "cash_in") === "" && sendProblem(50000, "cash_in") === "" && sendProblem(50001, "cash_in").includes("over") && sendProblem(5, "manual") === "");

// ---- senders ----
const phones = [
  { id: "d1", name: "rubel", status: "approved", allow_cashin: true, info: { wallets: [
    { provider: "bkash", number: "01704241450", slot: 0, found: true, kind: "agent" as const },
    { provider: "bkash", number: "01800000000", slot: 1, found: false, kind: "personal" as const },
    { provider: "rocket", number: "01900000000", slot: 1, found: false },
  ] } },
  { id: "d2", name: "Vivo", status: "approved", allow_cashin: false, info: { wallets: [{ provider: "nagad", number: "01706630756", slot: 0, found: true }] } },
  { id: "d3", name: "gone", status: "revoked", allow_cashin: true, info: { wallets: [{ provider: "bkash", number: "01711111111", slot: 0, found: true }] } },
];
const s = senderOptions(phones);
check("senders: bKash/Nagad/Rocket accounts of approved phones only, ready ones first", s.length === 4 && s[0]!.key === "d1:bkash:agent" && s[0]!.why === "", s);
check("a Rocket agent wallet can send (owner 2026-11-09)", s.some((o) => o.key === "d1:rocket:agent" && o.why === ""));
check("a personal account needs the phone's personal switch", s.some((o) => o.account === "personal" && o.why.includes("Personal accounts are switched off")));
const s2 = senderOptions([{ ...phones[0]!, allow_personal: true, info: { wallets: [
  { provider: "bkash", number: "01800000000", slot: 1, found: false, kind: "personal" as const },
  { provider: "nagad", number: "01600000000", slot: 1, found: false, kind: "personal" as const },
] } }]);
check("with the switch on, a personal bKash account can send (Send Money)", s2.some((o) => o.account === "personal" && o.provider === "bkash" && o.why === "") && sendMethod("personal") === "send_money" && sendMethod("agent") === "cash_in");
check("personal Nagad still waits for its recording", s2.some((o) => o.account === "personal" && o.provider === "nagad" && o.why.includes("not built yet")));
check("a phone with sending switched off says so", s.some((o) => o.deviceId === "d2" && o.why.includes("switched off")));

// ---- paid details ----
const po = (o: Partial<PayoutRow>): PayoutRow => ({
  id: "x", method: "cash_in", status: "paid", device_id: "d1", provider: "bkash", from_account: "agent", to_number: "01612667190",
  total_amount: 800, keep_pct: 20, keep_amount: 160, send_amount: 640, command_id: "c", trx_id: "DK8ABC", balance_after: 100,
  error: null, note: null, created_at: "2026-11-08T06:00:00Z", paid_at: "2026-11-08T06:01:00Z", ...o,
});
const line = payoutLine(po({}), (id) => (id === "d1" ? "rubel" : "?"));
check("paid line says amount, number, method, phone, TrxID and what was kept", line === "Tk 640 to 0161 266 7190 by Cash In from rubel's bKash · TrxID DK8ABC · kept Tk 160 (20%) of Tk 800", line);
check("a payout by hand has no phone", payoutLine(po({ method: "manual", device_id: null, trx_id: null }), () => "?") === "Tk 640 to 0161 266 7190 by paid by hand · kept Tk 160 (20%) of Tk 800");
const rec = recentNumbers([po({ to_number: "01700000001", created_at: "2026-11-08T01:00:00Z" }), po({ to_number: "01700000002", created_at: "2026-11-08T03:00:00Z" }), po({ to_number: "01700000001", created_at: "2026-11-08T04:00:00Z" }), po({ to_number: "01700000003", status: "failed", created_at: "2026-11-08T05:00:00Z" })]);
check("recent numbers: newest first, once each, failed ones left out", rec.join(",") === "01700000001,01700000002", rec);

// ---- the day check ----
const day = (o: Partial<DayMoneyRow>): DayMoneyRow => ({
  device_id: "d1", provider: "bkash", account: "agent", sim_slot: 0, cash_out_n: 3, cash_out: 1400, cash_in_n: 2, cash_in: 1640,
  b2b_in_n: 0, b2b_in: 0, b2b_out_n: 0, b2b_out: 0, received_n: 0, received: 0, sent_n: 0, sent: 0, held_n: 1, held: 700, unknown_sim_n: 0,
  from_sms: 5, from_statement: 0, from_paytrace: 0, gap_open_n: 0, gap_open: 0, checked: true, ...o,
});
check("agent shows Cash Out and Cash In first", figures(day({})).slice(0, 2).map((f) => f.label + " " + f.amount).join("|") === "Cash Out (money in) 1400|Cash In (money out) 1640");
check("personal shows Received and Sent", figures(day({ account: "personal", cash_out_n: 0, received_n: 1, received: 100 })).map((f) => f.label).join(",") === "Received,Sent");
check("titles say which account and SIM", accountTitle(day({})) === "bKash agent · SIM 1" && accountTitle(day({ account: "personal", sim_slot: 1 })) === "bKash personal · SIM 2");
check("no open gaps: all accounted for", checkLine(day({})).tone === "ok" && checkLine(day({})).text.startsWith("All accounted for"));
check("an open gap says how much came in unexplained", checkLine(day({ gap_open_n: 1, gap_open: 7002 })).text.startsWith("Tk 7,002 came in with no SMS"));
check("before the check existed it says so", checkLine(day({ checked: false })).tone === "idle");
check("messages without a SIM on a two-account phone are flagged", checkLine(day({ account: "unknown", unknown_sim_n: 4 })).text.startsWith("4 messages did not say which SIM"));
check("sources and holds are spelled out", sourceLine(day({ from_statement: 1, from_paytrace: 2 })) === "5 from SMS · 1 from the wallet's statement · 2 sent by PayTrace · 1 held for review (Tk 700) not counted");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
