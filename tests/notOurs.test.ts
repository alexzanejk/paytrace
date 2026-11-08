import { NOT_OURS_RULE, notOursLines, type NotOursRow } from "../dashboard/src/lib/notOurs.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

const rows: NotOursRow[] = [
  { device_id: "rubel", provider: "nagad", sim_slot: null, n: 5, last_at: "2026-11-08T00:00:00Z", amount: 2500 },
  { device_id: "sadikur", provider: "bkash", sim_slot: null, n: 3, last_at: null, amount: 1500 },
  { device_id: "vivo", provider: "bkash", sim_slot: 1, n: 2, last_at: null, amount: 1000 },
  { device_id: "vivo", provider: "bkash", sim_slot: null, n: 1, last_at: null, amount: 500 },
  { device_id: "other", provider: "rocket", sim_slot: 0, n: 0, last_at: null, amount: 0 },
];

const rubel = notOursLines(rows, "rubel", [{ provider: "bkash", slot: 0 }]);
check("a wallet kind the app does not have", rubel.length === 1 && rubel[0] === "Nagad: 5 messages in 7 days ignored as not yours (no Nagad wallet is set up in the app on this phone).", rubel);
const vivo = notOursLines(rows, "vivo", [{ provider: "bkash", slot: 0 }, { provider: "nagad", slot: 0 }]);
check("the other SIM of a wallet kind the app has, rows merged", vivo.length === 1 && vivo[0]!.startsWith("bKash: 3 messages in 7 days ignored as not yours (the app's bKash wallet is in SIM 1, these arrived on SIM 2)."), vivo);
check("singular", notOursLines([{ device_id: "x", provider: "rocket", sim_slot: null, n: 1, last_at: null, amount: 1 }], "x", [])[0]!.includes("1 message in 7 days"));
check("nothing ignored, nothing said; zero rows skipped", notOursLines(rows, "nobody", []).length === 0 && notOursLines(rows, "other", []).length === 0);
check("the rule names the app and says a phone without a wallet is left alone", NOT_OURS_RULE.includes("PayTrace app") && NOT_OURS_RULE.includes("left as before"));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
