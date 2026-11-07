import { FLOW_KINDS, FLOW_WORDS, agreement, groupFlows, hasFlows, sumFlows, type FlowRow } from "../dashboard/src/lib/flows.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

const rows: FlowRow[] = [
  { day: "2026-11-03", device_id: "a", provider: "bkash", kind: "cash_out", n: 3, amount: "1500.50" },
  { day: "2026-11-03", device_id: "a", provider: "bkash", kind: "cash_in", n: "1", amount: 5000 },
  { day: "2026-11-03", device_id: "a", provider: "rocket", kind: "b2b_out", n: 1, amount: 1040 },
  { day: "2026-11-03", device_id: "a", provider: "rocket", kind: "cash_out", n: 2, amount: 700 },
  { day: "2026-11-03", device_id: "a", provider: "nagad", kind: "something_new", n: 9, amount: 99999 },
];

const all = sumFlows(rows);
check("cash out adds across providers, strings included", all.cash_out.n === 5 && Math.abs(all.cash_out.amount - 2200.5) < 1e-9);
check("cash in and b2b are kept apart", all.cash_in.amount === 5000 && all.b2b_out.amount === 1040);
check("an unknown kind is ignored, never mis-filed", all.cash_out.n + all.cash_out_stmt.n + all.cash_in.n + all.b2b_out.n === 7);

// SMS vs statement agreement, per wallet and day.
const f = (sms: [number, number], stmt: [number, number]) => ({ ...sumFlows([]), cash_out: { n: sms[0], amount: sms[1] }, cash_out_stmt: { n: stmt[0], amount: stmt[1] } });
check("agree when count and amount match", agreement(f([3, 1500], [3, 1500])).tone === "ok");
check("SMS more than the statement is a warning that names the difference", /SMS has Tk 500 more/.test(agreement(f([3, 1500], [2, 1000])).text) && agreement(f([3, 1500], [2, 1000])).tone === "warn");
check("statement more than the SMS is a warning too", /statement has Tk 500 more/.test(agreement(f([2, 1000], [3, 1500])).text));
check("no statement yet is said, not flagged", agreement(f([2, 1000], [0, 0])).tone === "none" && /no statement/.test(agreement(f([2, 1000], [0, 0])).text));
check("nothing at all says nothing", agreement(f([0, 0], [0, 0])).text === "");
check("the statement column says it can show fewer on a busy day", /newest entries/.test(FLOW_WORDS.cash_out_stmt.meaning));

const byProvider = groupFlows(rows, (r) => r.provider);
check("grouped by provider", byProvider.get("rocket")?.b2b_out.n === 1 && byProvider.get("bkash")?.cash_in.n === 1);
check("a provider with only an unknown kind has nothing to show", hasFlows(byProvider.get("nagad")) === false);
check("empty input is all zero and has nothing to show", !hasFlows(sumFlows([])) && sumFlows([]).cash_out.amount === 0);

check("every kind has a label and an honest meaning", FLOW_KINDS.every((k) => FLOW_WORDS[k].label && FLOW_WORDS[k].meaning.length > 20));
check("cash in says it cannot see every cash-in", /no SMS/.test(FLOW_WORDS.cash_in.meaning));
check("b2b says only Rocket is recognised", /Rocket/.test(FLOW_WORDS.b2b_out.meaning));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
