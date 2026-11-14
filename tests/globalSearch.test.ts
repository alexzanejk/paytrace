import { bdNumber, canAskWalletApp, isFullMatch, numberForms, queryFromPath, queryLine, readQuery, searchHash } from "../dashboard/src/lib/globalSearch.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

check("a bKash TrxID", (() => { const q = readQuery(" dkb1cvd04l "); return q.kind === "trx" && q.text === "DKB1CVD04L"; })());
check("a Nagad TrxID (8 characters)", readQuery("76AUQR5I").kind === "trx");
check("a Rocket TxnId (digits only, not a phone number)", (() => { const q = readQuery("7123456789"); return q.kind === "trx" && q.text === "7123456789"; })());
check("a phone number, however it is written",
  ["01712345678", "+880 1712-345678", "8801712345678", "01712 345 678"].every((s) => { const q = readQuery(s); return q.kind === "number" && q.text === "01712345678"; }));
check("the number's forms: full, then each wallet's hidden-middle form", numberForms("01712345678").join() === "01712345678,0171XXXX678,017****5678,0171***5678,017XXXX5678");
check("only a full number is a sure match", isFullMatch("01712345678", "01712345678") && isFullMatch("+8801712345678", "01712345678") && !isFullMatch("0171XXXX678", "01712345678") && !isFullMatch(null, "01712345678"));
check("an order number with a dash", (() => { const q = readQuery("gw-f7a2bb8652"); return q.kind === "ref" && q.text === "GW-F7A2BB8652"; })());
check("a site's own order id", readQuery("ORD_2026-1107").kind === "ref");
check("nothing typed", readQuery("   ").kind === "none" && readQuery("").problem.length > 0);
check("too short", readQuery("ab1").kind === "none");
check("unsafe characters are refused, never searched", readQuery("abc%def").kind === "none" && readQuery("a,b.eq.1").kind === "none" && readQuery("x' or 1=1").kind === "none");
check("too long", readQuery("A".repeat(41)).kind === "none");
check("bdNumber refuses other things", bdNumber("0171234567") === null && bdNumber("12345678901") === null);
check("the address round trip", queryFromPath(searchHash(" +880 1712-345678 ").split("/")[2]) === "+880 1712-345678");
check("a broken address is empty, not a crash", queryFromPath("%E0%A4%A") === "" && queryFromPath(undefined) === "");
check("the wallet app can be asked for a TrxID of 8 to 12 and for a number, not for an order number",
  canAskWalletApp(readQuery("DKB1CVD04L")) && canAskWalletApp(readQuery("01712345678")) && !canAskWalletApp(readQuery("GW-F7A2BB8652")) && !canAskWalletApp(readQuery("ABCDEF")));
check("the line says what is searched", queryLine(readQuery("01712345678")) === "Phone number 01712345678" && queryLine(readQuery("gw-1234")) === "Order number GW-1234");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
