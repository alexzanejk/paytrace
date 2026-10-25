import { extractKey, isUuid, normalizeGroup, normalizeTrx, parseDeposit, signWebhook, submitState } from "../supabase/functions/gateway/logic.ts";
import { createHmac } from "node:crypto";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

const KEY = "ptk_" + "a1b2c3d4".repeat(8);
check("a dashboard-made key is accepted", extractKey(`Bearer ${KEY}`) === KEY);
check("junk keys are refused", extractKey("Bearer nope") === null && extractKey(null) === null && extractKey(KEY + "ab") === null);

const TN = "c3b20370-3538-4e29-922f-c60a2d17595c";
check("a tracking number must be a UUID", isUuid(TN) && !isUuid("abc") && !isUuid(`${TN}x`) && !isUuid(undefined) && !isUuid(5));

check("a typed TrxID is tidied", normalizeTrx(" bk12 ab34cd ") === "BK12AB34CD");
check("a TrxID with symbols or a short one is refused", normalizeTrx("AB-12") === null && normalizeTrx("AB12") === null && normalizeTrx("A".repeat(41)) === null && normalizeTrx(12345678) === null);

// creating a deposit
const ok = parseDeposit({ amount: 500, order_id: "SHOP-1", provider: "BKash", method: "Cash_Out", return_url: "https://shop.example/thanks", expires_in_minutes: 20 });
check("a full request is read", !("error" in ok) && ok.amount === 500 && ok.orderId === "SHOP-1" && ok.provider === "bkash" && ok.method === "cash_out" && ok.expiresMinutes === 20 && ok.returnUrl === "https://shop.example/thanks");
const min = parseDeposit({ amount: "500.50", order_id: 1001, provider: "nagad" });
check("amount as text and a numeric order id are accepted", !("error" in min) && min.amount === 500.5 && min.orderId === "1001" && min.provider === "nagad" && min.method === null && min.returnUrl === null);
check("no amount is refused", "error" in parseDeposit({ order_id: "x", provider: "bkash" }));
check("zero, negative or odd amounts are refused", "error" in parseDeposit({ amount: 0, order_id: "x", provider: "bkash" }) && "error" in parseDeposit({ amount: -5, order_id: "x", provider: "bkash" }) && "error" in parseDeposit({ amount: "5e3", order_id: "x", provider: "bkash" }) && "error" in parseDeposit({ amount: "abc", order_id: "x", provider: "bkash" }));
check("no order id is refused", "error" in parseDeposit({ amount: 100, provider: "bkash" }) && "error" in parseDeposit({ amount: 100, order_id: "", provider: "bkash" }) && "error" in parseDeposit({ amount: 100, order_id: "x".repeat(101), provider: "bkash" }));
check("the provider is required (the website's own page chooses it)", "error" in parseDeposit({ amount: 100, order_id: "x" }) && "error" in parseDeposit({ amount: 100, order_id: "x", provider: "" }));
check("an unknown method is refused", "error" in parseDeposit({ amount: 100, order_id: "x", provider: "nagad", method: "vip" }));
check("an unknown provider is refused", "error" in parseDeposit({ amount: 100, order_id: "x", provider: "paypal" }));
check("a return address must be https", "error" in parseDeposit({ amount: 100, order_id: "x", provider: "bkash", return_url: "http://shop.example" }) && "error" in parseDeposit({ amount: 100, order_id: "x", provider: "bkash", return_url: "javascript:alert(1)" }));
check("expiry must be 3 to 60 whole minutes", "error" in parseDeposit({ amount: 100, order_id: "x", provider: "bkash", expires_in_minutes: 2 }) && "error" in parseDeposit({ amount: 100, order_id: "x", provider: "bkash", expires_in_minutes: 61 }) && "error" in parseDeposit({ amount: 100, order_id: "x", provider: "bkash", expires_in_minutes: 5.5 }));

// wallet groups
const base = { amount: 500, order_id: "x", provider: "bkash" };
const gDefault = parseDeposit(base);
check("no group means main", !("error" in gDefault) && gDefault.group === "main");
const gP = parseDeposit({ ...base, group: " p-ab12 " });
check("a group is tidied to upper case", !("error" in gP) && gP.group === "P-AB12");
const gM = parseDeposit({ ...base, group: "MAIN" });
check("main is always lower case", !("error" in gM) && gM.group === "main" && normalizeGroup("Main") === "main");
check("a group longer than 24 characters or not text is refused", "error" in parseDeposit({ ...base, group: "P-" + "A".repeat(23) }) && "error" in parseDeposit({ ...base, group: 5 }));
check("a group of exactly 24 characters is read (the database then falls back to main if it does not exist)", !("error" in parseDeposit({ ...base, group: "P-" + "A".repeat(22) })));

// what the page does with each answer
check("matched means paid", submitState("matched") === "paid" && submitState("already_paid") === "paid");
check("waiting for the SMS is shown as checking", submitState("waiting_for_payment") === "checking");
check("held payments say so", submitState("review") === "review");
check("a TrxID used elsewhere is reported", submitState("payment_already_used") === "used" && submitState("trx_already_claimed") === "used");
check("a receipt of the wrong kind is reported", submitState("tracked_only") === "wrong_method");
check("expired, too many tries, invalid and closed are told apart",
  submitState("expired") === "expired" && submitState("too_many_attempts") === "too_many" && submitState("invalid_input") === "invalid" && submitState("cancelled") === "closed");
check("anything unknown is treated as still checking, never as paid", submitState("something_new") === "checking" && submitState("") === "checking");

// the signature a website verifies
const body = JSON.stringify({ event: "deposit.paid", data: { order_id: "SHOP-1" } });
const sig = await signWebhook("whsec_test", 1700000000, body);
const expected = createHmac("sha256", "whsec_test").update(`1700000000.${body}`).digest("hex");
check("the signature is HMAC-SHA256 over timestamp.body", sig === `t=1700000000,v1=${expected}`, sig);
check("another secret gives another signature", (await signWebhook("whsec_other", 1700000000, body)) !== sig);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
