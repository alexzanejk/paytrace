import { authenticate, normalizeProvider, normalizeTrx, parseKeys } from "../supabase/functions/verify-transaction/logic.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

const A = "a".repeat(40), B = "b".repeat(40);

// keys
check("no secret: no keys", parseKeys(undefined).length === 0 && parseKeys("").length === 0);
check("two keys are read, spaces ignored", parseKeys(` ${A} , ${B} `).length === 2);
check("a short key is ignored, so a weak key never works", parseKeys("short," + A).length === 1);

// auth
const keys = [A, B];
check("correct key (Bearer) is accepted", authenticate(`Bearer ${A}`, keys) === A);
check("the second key works too", authenticate(`Bearer ${B}`, keys) === B);
check("the bare key without 'Bearer' is accepted", authenticate(A, keys) === A);
check("wrong key is refused", authenticate("Bearer " + "c".repeat(40), keys) === null);
check("a prefix of a real key is refused", authenticate("Bearer " + A.slice(0, 39), keys) === null);
check("a real key with extra characters is refused", authenticate("Bearer " + A + "x", keys) === null);
check("no header is refused", authenticate(null, keys) === null && authenticate("", keys) === null);
check("no configured keys: nothing is accepted", authenticate(`Bearer ${A}`, []) === null);

// transaction IDs
check("trims and upper-cases what a customer typed", normalizeTrx("  bk12ab34cd ") === "BK12AB34CD");
check("a normal ID passes", normalizeTrx("EXAMPLE123") === "EXAMPLE123");
check("too short is not an ID", normalizeTrx("AB12") === null);
check("too long is not an ID", normalizeTrx("A".repeat(41)) === null);
check("spaces or symbols inside are not an ID", normalizeTrx("AB 12 CD 34") === null && normalizeTrx("AB12-CD34") === null);
check("a SQL-looking string is not an ID", normalizeTrx("x'; drop table payments;--") === null);
check("a number or object is not an ID", normalizeTrx(1234567890) === null && normalizeTrx({}) === null && normalizeTrx(null) === null);

// provider
check("no provider means search all", normalizeProvider(undefined) === undefined && normalizeProvider("") === undefined);
check("known providers, any case", normalizeProvider("bKash") === "bkash" && normalizeProvider(" NAGAD ") === "nagad" && normalizeProvider("rocket") === "rocket" && normalizeProvider("upay") === "upay");
check("an unknown provider is an error, not a silent search of everything", normalizeProvider("paypal") === null && normalizeProvider(5) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
