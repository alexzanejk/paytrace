import {
  GENUINE, HOW_IT_FITS, HUB_VIEW, ORDER_STATUS, PAGE_INTRO, PAYMENT_STATUS, PAYMENT_TYPE, SAME_THING, genuineWord, hubView,
} from "../dashboard/src/lib/words.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

// Every code the database can hand the dashboard has plain words. A missing one would print the raw code to the team.
const PAYMENT_CODES = ["matched", "unmatched", "tracked_only", "review", "ignored"];
const ORDER_CODES = ["pending", "paid", "review", "expired", "cancelled"];
const TYPE_CODES = ["payment_received", "send_money_received", "cash_out", "unknown"];

check("every payment status has words", PAYMENT_CODES.every((c) => PAYMENT_STATUS[c]?.label && PAYMENT_STATUS[c]?.meaning));
check("every order status has words", ORDER_CODES.every((c) => ORDER_STATUS[c]?.label && ORDER_STATUS[c]?.meaning));
check("every SMS kind has words", TYPE_CODES.every((c) => PAYMENT_TYPE[c]?.label && PAYMENT_TYPE[c]?.meaning));
check("every payment status has an Admin Hub view", PAYMENT_CODES.every((c) => HUB_VIEW[c]?.label));

// No raw database code leaks through as a label.
const leaks = (w: Record<string, { label: string }>) => Object.values(w).filter((x) => /_/.test(x.label) || /^[a-z]+$/.test(x.label));
check("no label is a raw code (payment)", leaks(PAYMENT_STATUS).length === 0, leaks(PAYMENT_STATUS));
check("no label is a raw code (order)", leaks(ORDER_STATUS).length === 0, leaks(ORDER_STATUS));

// Admin Hub alignment (its code: found = VERIFIED, found-but-held = HELD FOR REVIEW, not found = UNVERIFIED).
check("found payments show VERIFIED in Admin Hub", ["matched", "unmatched", "tracked_only"].every((c) => hubView(c).label === "VERIFIED"));
check("a held payment shows HELD FOR REVIEW", hubView("review").label === "HELD FOR REVIEW");
check("an ignored payment shows UNVERIFIED", hubView("ignored").label === "UNVERIFIED");
check("an unknown status has no Admin Hub view, and says so", hubView("zzz").label === "—");
check("the Review page keeps its Admin Hub name", PAGE_INTRO.review.title === "Review" && PAYMENT_STATUS.review.label === "Held for review");
check("orders use Admin Hub's approval words where they mean the same", ORDER_STATUS.pending.label === "Waiting" && ORDER_STATUS.cancelled.label === "Cancelled");
check("the wallet is called a gateway, as in Admin Hub", SAME_THING.some((r) => r.hub === "Gateway" && r.here === "Gateway"));
check("Admin Hub's approval is explained as Admin Hub's, not PayTrace's", SAME_THING.some((r) => r.hub.startsWith("Approval") && /PayTrace never approves/.test(r.note)));

// Tones: what needs a person is amber, what is done is green, what is dropped is red.
check("held is amber, credited is green, ignored is red", PAYMENT_STATUS.review.tone === "warn" && PAYMENT_STATUS.matched.tone === "ok" && PAYMENT_STATUS.ignored.tone === "bad");
check("received-no-order is calm, not a warning", PAYMENT_STATUS.unmatched.tone === "idle");

// The balance check, in words.
check("genuine: ok / mismatch / none", genuineWord("ok").label === "Yes" && genuineWord("mismatch").label === "Can't tell" && genuineWord(null).label === "Not checked");
check("genuine words never claim proof from a mismatch", /Not proof/.test(GENUINE.mismatch.meaning));

// Intros: short, and the three money pages tell one story.
check("every intro has a what and 1-3 lines", Object.values(PAGE_INTRO).every((p) => p.what.length > 10 && p.lines.length >= 1 && p.lines.length <= 3));
check("the story has three steps in money order", HOW_IT_FITS.map((s) => s.word).join(">") === "expected>arrived>held");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
