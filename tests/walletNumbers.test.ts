import { depositCoverage, normalizeBdNumber, walletSuggestions } from "../dashboard/src/lib/walletNumbers.ts";
import type { DeviceWallet } from "../dashboard/src/lib/types.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

check("plain, spaced, +880 and 880 forms all become the 01 form", ["01712345678", "017 1234 5678", "+880 1712-345678", "8801712345678"].every((s) => normalizeBdNumber(s) === "01712345678"));
check("the 10-digit number that reached 89 customers is refused", normalizeBdNumber("0183493489") === null);
check("12 digits, a landline and empty are refused", normalizeBdNumber("017123456789") === null && normalizeBdNumber("02712345678") === null && normalizeBdNumber("") === null && normalizeBdNumber(null) === null);

const w = (provider: string, wallet_number: string, device_id = "a", enabled = true): DeviceWallet =>
  ({ id: provider + wallet_number, device_id, provider, wallet_number, method: "cash_out", enabled, wallet_group: "main" });

const reported = [
  { provider: "bkash", number: "01704241450", slot: 0, found: true },
  { provider: "nagad", number: "01834934890", slot: 1, found: false },
  { provider: "rocket", number: "0183493489", slot: 1, found: false },
  { provider: "nagad", number: "01999999999", slot: 0, found: true },
];
const sug = walletSuggestions(reported, [w("nagad", "0183493489")]);
check("a reported number with no deposit number is offered as missing", sug.find((s) => s.provider === "bkash")?.state === "missing");
check("a reported number that differs from the dashboard says so and carries the saved row", sug.find((s) => s.provider === "nagad")?.state === "differs" && sug.find((s) => s.provider === "nagad")?.saved?.wallet_number === "0183493489");
check("a reported number that is not a valid number is never offered", !sug.some((s) => s.provider === "rocket"));
check("a provider reported twice keeps the first", sug.filter((s) => s.provider === "nagad").length === 1 && sug.find((s) => s.provider === "nagad")?.number === "01834934890");
check("the same number on both sides is a match", walletSuggestions(reported, [w("bkash", "01704241450")])[0]?.state === "matches");
check("nothing reported, nothing offered", walletSuggestions(undefined, []).length === 0 && walletSuggestions([], []).length === 0);

const phones = [{ id: "a", name: "Xiaomi", status: "approved" }, { id: "old", name: "Vivo (old)", status: "revoked" }];
const cov = depositCoverage([w("nagad", "0183493489", "a"), w("bkash", "01706630756", "old"), w("rocket", "01712345678", "a", false)], phones);
check("a revoked phone's number does not count, so bKash is missing", cov.missing.includes("bkash"));
check("a switched-off number does not count, so Rocket is missing", cov.missing.includes("rocket"));
check("an invalid live number is reported with its phone, and Nagad counts as missing", cov.invalid.length === 1 && cov.invalid[0].phone === "Xiaomi" && cov.invalid[0].number === "0183493489" && cov.missing.includes("nagad"));
const good = depositCoverage([w("nagad", "01834934890"), w("bkash", "01704241450"), w("rocket", "01712345678")], phones);
check("three valid live numbers mean nothing is missing or invalid", good.missing.length === 0 && good.invalid.length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
