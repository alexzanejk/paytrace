import { amountNote, typedOrderFor } from "../dashboard/src/lib/reviewOrder.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

const o = (id: string, trx: string | null, status = "review", provider: string | null = "bkash", created_at = "2026-11-11T10:00:00Z") =>
  ({ id, order_no: "GW-" + id, status, expected_amount: 500, claimed_trx_id: trx, claimed_provider: provider, created_at });
const pay = { trx_id: "DKB2CKINUE", provider: "bkash" };

check("the order that typed the exact TrxID", typedOrderFor(pay, [o("A", "XX"), o("B", "DKB2CKINUE")])?.id === "B");
check("case and spaces do not matter", typedOrderFor(pay, [o("B", " dkb2ckinue ")])?.id === "B");
check("no exact TrxID = no order (no guessing)", typedOrderFor(pay, [o("A", "DKB2CKINUF"), o("C", null)]) === null);
check("another wallet's order is never offered", typedOrderFor(pay, [o("B", "DKB2CKINUE", "review", "nagad")]) === null);
check("a paid or cancelled order is never offered", typedOrderFor(pay, [o("B", "DKB2CKINUE", "paid"), o("C", "DKB2CKINUE", "cancelled")]) === null);
check("an expired order still can be (late SMS)", typedOrderFor(pay, [o("B", "DKB2CKINUE", "expired")])?.id === "B");
check("two orders typed it: the newest", typedOrderFor(pay, [o("A", "DKB2CKINUE", "expired", "bkash", "2026-11-11T09:00:00Z"), o("B", "DKB2CKINUE", "review", "bkash", "2026-11-11T09:30:00Z")])?.id === "B");

const money = (n: number) => `Tk ${n}`;
check("same amount: nothing to say", amountNote(500, "500.00", money) === "");
check("different amount is said plainly", amountNote(500, 495, money) === "The order asked for Tk 500, Tk 495 was paid. The website will be told Tk 495 was paid.");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
