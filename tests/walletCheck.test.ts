import { walletCheckLine, type PaymentCheck } from "../dashboard/src/lib/walletCheck.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}
const c = (o: Partial<PaymentCheck>): PaymentCheck => ({ id: "c", payment_id: "p", step: "balance", command_id: "x", status: "queued", detail: null, created_at: "", finished_at: null, ...o });

check("nothing asked yet", walletCheckLine(null) === null);
check("queued balance", walletCheckLine(c({}))?.startsWith("Asking the phone for the wallet's live balance") === true);
check("not confirmed carries the detail", walletCheckLine(c({ step: "statement", status: "not_confirmed", detail: "no Tk 500" }))?.includes("no Tk 500") === true);
check("failed shows the phone's reason", walletCheckLine(c({ status: "failed", detail: "The balance check did not run: phone_locked" }))?.includes("phone_locked") === true);
check("confirmed", walletCheckLine(c({ status: "confirmed", detail: "same" }))?.startsWith("Confirmed by the wallet's live balance") === true);
check("a start error is worded", walletCheckLine(null, "busy")?.includes("busy") === true && walletCheckLine(null, "weird")?.includes("weird") === true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
