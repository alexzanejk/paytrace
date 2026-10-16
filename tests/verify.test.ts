import { amountsEqual, extractKey, normalizeAmount, normalizeProvider, normalizeTrx } from "../supabase/functions/verify-transaction/logic.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

const KEY = "ptk_" + "a1b2c3d4".repeat(8);

// keys: only the exact shape the dashboard makes is looked up at all
check("a dashboard-made key (Bearer) is accepted", extractKey(`Bearer ${KEY}`) === KEY);
check("the bare key without 'Bearer' is accepted", extractKey(KEY) === KEY);
check("surrounding spaces are tidied", extractKey(`  Bearer   ${KEY}  `) === KEY);
check("no header is refused", extractKey(null) === null && extractKey("") === null && extractKey(undefined) === null);
check("a key with the wrong prefix is refused", extractKey("Bearer xyz_" + "a1b2c3d4".repeat(8)) === null);
check("a key that is too short or too long is refused", extractKey(KEY.slice(0, 60)) === null && extractKey(KEY + "ab") === null);
check("upper-case or non-hex characters are refused", extractKey("ptk_" + "G".repeat(64)) === null && extractKey("ptk_" + "A1B2C3D4".repeat(8)) === null);
check("the old shared-secret style is refused", extractKey("Bearer " + "a".repeat(40)) === null);

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

// amounts
check("no amount means none given", normalizeAmount(undefined) === undefined && normalizeAmount("") === undefined && normalizeAmount(null) === undefined);
check("a number or numeric text is accepted", normalizeAmount(500) === 500 && normalizeAmount("500.50") === 500.5 && normalizeAmount(" 1250 ") === 1250);
check("a comma decimal is accepted", normalizeAmount("500,50") === 500.5);
check("zero, negative and junk are refused", normalizeAmount(0) === null && normalizeAmount(-5) === null && normalizeAmount("abc") === null && normalizeAmount("1e9") === null && normalizeAmount(NaN) === null);
check("thousands separators are refused rather than misread", normalizeAmount("1,250.50") === null);
check("500, 500.0 and 500.00 are the same amount", amountsEqual(500, 500.0) && amountsEqual(500, Number("500.00")));
check("one paisa off is a different amount", !amountsEqual(500, 500.01) && !amountsEqual(500.5, 500));
check("floating point noise does not break a match", amountsEqual(0.1 + 0.2, 0.3));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
