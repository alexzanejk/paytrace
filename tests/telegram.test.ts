import { readFileSync } from "node:fs";
import { trxCandidates } from "../supabase/functions/telegram/candidates.ts";
import { trxCandidates as workerCandidates } from "../ocr-worker/src/candidates.ts";
import { replyFor } from "../supabase/functions/telegram/wording.ts";
import {
  STATUS_ORDER, STATUS_WORDS, claimDetail, cleanTrx, connectState, needsOwner, paymentLine, periodRange, personLabel, statusCounts, userLabel,
  type Claim,
} from "../dashboard/src/lib/telegram.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---- the TrxID reader: the real OCR reads of 2026-11-20 ----
const sample = "TrxID DKJONWWLEH Dp 777bajii 01704241450 76CCGNVE 7ECP7UQZ aaaa 1234567890 SUCCESSFUL abcdefgh TrxID:DKJ5NIP2IJ. dkj9nj4deb";
const want = ["DKJONWWLEH", "777BAJII", "76CCGNVE", "7ECP7UQZ", "1234567890", "SUCCESSFUL", "DKJ5NIP2IJ", "DKJ9NJ4DEB"];
check("candidates: 8 with letter and digit, 10 with a letter (a bKash digit read as O still counts), 10 digits, upper case, once, in order", same(trxCandidates(sample), want), trxCandidates(sample));
check("a phone number (11 digits) and short words are not candidates", same(trxCandidates("01704241450 Cash Out Fee Tk 9.25"), []));
check("nothing in empty or null", same(trxCandidates(""), []) && same(trxCandidates(null), []));
check("the worker's copy reads the same", same(workerCandidates(sample), trxCandidates(sample)));
check("the two TypeScript copies are byte for byte the same file", readFileSync("supabase/functions/telegram/candidates.ts", "utf8") === readFileSync("ocr-worker/src/candidates.ts", "utf8"));
check("the SQL copy carries the same rule", /length\(t\) = 8 and t ~ '\[A-Z\]' and t ~ '\[0-9\]'\) or \(length\(t\) = 10 and t ~ '\[A-Z\]'\) or \(t ~ '\^\[0-9\]\{10\}\$'\)/.test(readFileSync("supabase/migrations/20261120_112_telegram_claims.sql", "utf8")));
check("113 keeps 112's reader and adds paid, the thumbs-up and the site username", /tg_claim_judge2/.test(readFileSync("supabase/migrations/20261120_113_telegram_react_and_username.sql", "utf8")) && /'paid'/.test(readFileSync("supabase/migrations/20261120_113_telegram_react_and_username.sql", "utf8")));

// ---- the bot's replies ----
const base = { kind: "text" as const, ocrStatus: "none" as const, trx: "DKJ9NWWLEH", amount: 500 };
check("mode off: silence always", replyFor({ ...base, status: "unmatched", mode: "off" }) === null && replyFor({ ...base, status: "matched", mode: "off" }) === null);
check("a match is answered only in 'all'", replyFor({ ...base, status: "matched", mode: "problems" }) === null && replyFor({ ...base, status: "matched", mode: "all" })?.kind === "received");
check("'received' never says found or verified", !/পাওয়া|found|verified/i.test(replyFor({ ...base, status: "matched", mode: "all" })!.text));
check("held is answered in 'problems'", replyFor({ ...base, status: "held", mode: "problems" })?.kind === "held");
check("a photo not yet read is not asked for text", replyFor({ ...base, kind: "photo", ocrStatus: "pending", status: "unmatched", mode: "problems" }) === null);
check("a photo read with no TrxID is asked for the TrxID as text", replyFor({ ...base, kind: "photo", ocrStatus: "done", status: "unmatched", mode: "problems" })?.kind === "ask_trx");
check("a text with no TrxID is asked at once", replyFor({ ...base, status: "unmatched", mode: "problems" })?.kind === "ask_trx");
check("duplicate and conflict are answered neutrally", replyFor({ ...base, status: "duplicate", mode: "problems" })?.kind === "duplicate" && !/thief|fake/i.test(replyFor({ ...base, status: "conflict", mode: "problems" })!.text));
check("new, paid, review and ignored are silent", ["new", "paid", "review", "ignored"].every((s) => replyFor({ ...base, status: s as never, mode: "all" }) === null));
check("the TrxID in a reply is cleaned", replyFor({ ...base, trx: "DKJ9<b>NWWLEH", status: "held", mode: "all" })!.text.includes("DKJ9BNWWLEH") === true);

// ---- the page's pure parts ----
check("every status has words and a place in the order", STATUS_ORDER.length === 9 && STATUS_ORDER.every((s) => STATUS_WORDS[s].label.length > 0));
check("the person is named by the site login first, else the Telegram @username", personLabel({ site_username: "t9ceff6182", name: "Crazy", username: "cra_zy1", tg_user_id: 1 }) === "t9ceff6182 · @cra_zy1" && personLabel({ site_username: null, name: "Rifat", username: null, tg_user_id: 2 }) === "Rifat");
check("user labels: @username before the display name (names are not unique, owner 2026-11-20)", userLabel({ name: "Alice", username: "alice", tg_user_id: 1 }) === "@alice" && userLabel({ name: null, username: null, tg_user_id: 7001 }) === "user 7001" && userLabel({ name: "", username: "bob", tg_user_id: 2 }) === "@bob" && userLabel({ name: "Only Name", username: null, tg_user_id: 3 }) === "Only Name");
const pay = { id: "p", trx_id: "DKJ9NWWLEH", provider: "bkash", amount: 2781, status: "tracked_only", review_reason: null, counterparty: "0182XXXX112", occurred_at: null, phone: "Vivo", paid_out: true };
check("payment line", paymentLine(pay) === "bKash Tk 2,781.00 · TrxID DKJ9NWWLEH · Vivo · already in a payout" && paymentLine(null) === "no transaction");
const claim = (over: Partial<Claim>): Claim => ({
  id: "c", status: "matched", kind: "photo", note: null, candidates: [], ocr_status: "done", tg_user_id: 1, username: "alice", name: "Alice",
  chat_id: -1, message_id: 1, sent_at: "2026-11-20T10:00:00Z", payment: pay, first_claim: null, ...over,
});
check("detail: conflict names the first poster", claimDetail(claim({ status: "conflict", first_claim: { id: "x", tg_user_id: 2, username: "bob", name: "Bob", sent_at: "" } })) === "first submitted by @bob");
check("detail: a new photo waits for the worker", claimDetail(claim({ status: "new", ocr_status: "pending" })) === "waiting for the OCR worker");
check("detail: the note wins, else the read strings", claimDetail(claim({ status: "unmatched", note: "no TrxID in it" })) === "no TrxID in it" && claimDetail(claim({ note: null, candidates: ["A1B2C3D4"] })) === "read: A1B2C3D4");
const counts = statusCounts([claim({}), claim({ status: "conflict" }), claim({ status: "unmatched" }), claim({ status: "held" })]);
check("counts and what needs the owner", counts.matched === 1 && counts.conflict === 1 && needsOwner(counts) === 2);
check("connect state: no token", connectState(null, { configured: false }).state === "no_token");
check("connect state: webhook not set", connectState({ group_chat_id: null, group_title: null, reply_mode: "problems", webhook_set_at: null, bot_username: null }, { configured: true, webhook_ok: false, bot: "pt_bot" }).state === "not_connected");
check("connect state: no group yet", connectState({ group_chat_id: null, group_title: null, reply_mode: "problems", webhook_set_at: "x", bot_username: "pt_bot" }, { configured: true, webhook_ok: true, bot: "pt_bot" }).state === "no_group");
check("connect state: ready", connectState({ group_chat_id: -1, group_title: "Payments", reply_mode: "problems", webhook_set_at: "x", bot_username: "pt_bot" }, { configured: true, webhook_ok: true, bot: "pt_bot" }).line === "Receiving Payments as @pt_bot.");
const r = periodRange("today", new Date("2026-11-20T20:30:00Z"));
check("today starts at midnight Dhaka", r.from.toISOString() === "2026-11-20T18:00:00.000Z");
check("7 days back", periodRange("7d", new Date("2026-11-20T20:30:00Z")).from.toISOString() === "2026-11-13T20:30:00.000Z");
check("a typed TrxID is cleaned", cleanTrx(" dkj9 nwwleh ") === "DKJ9NWWLEH");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
