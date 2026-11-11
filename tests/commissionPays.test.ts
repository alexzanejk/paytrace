import { readFileSync } from "node:fs";
import {
  carryOf, partnersOwed, payLine, payable, sendOptions, sizeProblem, splitCommission,
  type CommissionDayRow, type CommissionPayRow,
} from "../dashboard/src/lib/commissionPays.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

// The same sums as the database (live test 2026-11-08: Tk 2,794.72 due -> 2,794 sent, 0.72 carried).
check("Cash In: whole taka sent, paisa carried", JSON.stringify(splitCommission(2794.72, 0, 0)) === JSON.stringify({ total: 2794.72, send: 2794, carryOut: 0.72 }));
check("Send Money: the bKash fee comes off the commission", JSON.stringify(splitCommission(250.37, 0, 10)) === JSON.stringify({ total: 250.37, send: 240, carryOut: 0.37 }));
check("earlier paisa is added to the next payment", splitCommission(100.5, 0.72, 0).send === 101 && splitCommission(100.5, 0.72, 0).carryOut === 0.22);
const sql = readFileSync(new URL("../supabase/migrations/20261108_068_commission_daily_payouts.sql", import.meta.url), "utf8");
check("the database sends floor(total - fee)", sql.includes("v_send := floor(v_total - v_fee);"));
check("commission comes from Cash Out only", sql.includes("where device_id is not null and counted and txn_type = 'cash_out'"));
check("a day can be in one live payment only", sql.includes("create unique index if not exists commission_pay_days_one_live on public.commission_pay_days (device_id, day) where live"));

check("size: under 100 refused, 100..50,000 fine", sizeProblem(99).includes("under") && sizeProblem(100) === "" && sizeProblem(50000) === "" && sizeProblem(50001).includes("over"));

const row = (o: Partial<CommissionDayRow>): CommissionDayRow => ({ device_id: "A", day: "2026-11-07", commission: 100, pay_id: null, pay_status: null, lump: 0, due: 100, state: "due", ...o });
check("a due day can be ticked; running, paid and sending cannot",
  payable(row({})) && payable(row({ state: "part", due: 40 })) && !payable(row({ state: "running", due: 0 })) && !payable(row({ state: "paid", due: 0 })) && !payable(row({ state: "sending", due: 0 })) && !payable(row({ state: "paid_before", due: 0 })));
const owed = partnersOwed([row({}), row({ day: "2026-11-06", due: 50.5 }), row({ device_id: "B", due: 300 }), row({ device_id: "C", state: "paid", due: 0 })]);
check("partners owed, most first", owed.length === 2 && owed[0]!.deviceId === "B" && owed[1]!.due === 150.5 && owed[1]!.days === 2, owed);

const pay = (o: Partial<CommissionPayRow>): CommissionPayRow => ({
  id: "p", device_id: "A", method: "cash_in", status: "paid", from_device_id: "A", provider: "bkash", to_number: "01712345678",
  days_amount: 2794.72, carry_in: 0, fee_reserved: 0, send_amount: 2794, carry_out: 0.72, fee_actual: null, trx_id: "DK1", error: null, note: null,
  created_at: "2026-11-08T06:00:00Z", paid_at: "2026-11-08T06:01:00Z", ...o,
});
check("carry counts live payments only", carryOf([pay({}), pay({ id: "q", status: "failed", carry_out: 0.5 }), pay({ id: "r", carry_in: 0.72, carry_out: 0.1 })], "A") === 0.1);
check("cash-in line", payLine(pay({}), () => "rubel") === "Tk 2,794 by Cash In from rubel's bKash to 01712345678 · TrxID DK1 · Tk 0.72 carried to the next payment");
check("send money line shows the fee", payLine(pay({ method: "send_money", from_device_id: "V", fee_reserved: 10, fee_actual: 10, send_amount: 240, carry_out: 0 }), () => "Vivo").includes("Send Money from Vivo's bKash (personal)") && payLine(pay({ method: "send_money", fee_reserved: 10, fee_actual: 10, send_amount: 240, carry_out: 0 }), () => "Vivo").includes("bKash fee Tk 10"));
check("by hand line", payLine(pay({ method: "manual", from_device_id: null, provider: null, to_number: null, trx_id: null, send_amount: 300, carry_out: 0 }), () => "?") === "Tk 300 by paid by hand");

const phones = [
  { id: "A", name: "rubel", status: "approved", allow_cashin: true, info: { wallets: [{ provider: "bkash", number: "01704241450" }, { provider: "rocket", number: "019" }] } },
  { id: "V", name: "Vivo", status: "approved", allow_cashin: true, allow_personal: true, info: { wallets: [{ provider: "bkash", number: "01800000000", kind: "personal" }] } },
  { id: "S", name: "SADIKUR", status: "approved", allow_cashin: false, allow_personal: true, info: { wallets: [{ provider: "bkash", number: "01900000000", kind: "personal" }] } },
  { id: "N", name: "Nagad agent", status: "approved", allow_cashin: true, info: { wallets: [{ provider: "nagad", number: "01600000000", kind: "agent" }] } },
];
const o = sendOptions("A", phones);
check("options: the partner's own bKash and Rocket agent wallets first, then other agents, and every personal bKash", o.length === 5 && o[0]!.method === "cash_in" && o[0]!.fromDevice === "A" && o[0]!.label.includes("own") && o.filter((x) => x.method === "send_money").length === 2, o);
check("another phone's agent wallet can pay (owner 2026-11-11)", o.some((x) => x.method === "cash_in" && x.fromDevice === "N" && x.provider === "nagad" && !x.label.includes("own") && x.why === ""));
check("a phone with sending switched off says so", o.some((x) => x.fromDevice === "S" && x.why.includes("switched off")));
check("a Rocket agent wallet is offered by Cash In (owner 2026-11-09)", o.some((x) => x.provider === "rocket" && x.method === "cash_in" && x.label.includes("Rocket agent wallet")));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
