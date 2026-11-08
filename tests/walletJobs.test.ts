import { readFileSync } from "node:fs";
import { defaultLabel, parseJobAmount, standing, wantFor, type WalletJobRow } from "../dashboard/src/lib/walletJobs.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

const row = (o: Partial<WalletJobRow>): WalletJobRow => ({
  device_id: "d", provider: "bkash", balance: 9000, balance_at: null, own_money: 7000, kind: "cashin", kind_own: false,
  threshold: 8000, threshold_own: false, showing: null, numbers: 3, ...o,
});

check("amounts: 5,000 and Tk 5000 read, empty = default, junk and under 100 refused",
  parseJobAmount("5,000") === 5000 && parseJobAmount("Tk 5000") === 5000 && parseJobAmount("") === "" && parseJobAmount("abc") === null && parseJobAmount("50") === null);
check("to go", standing(row({}), true).text === "Tk 1,000 to go before the job starts.", standing(row({}), true));
check("job on the phone", standing(row({ showing: "cashin", own_money: 9000 }), true).text.startsWith("Taka job is on the phone"));
check("a Taka job with no saved number says so", standing(row({ provider: "rocket", numbers: 0 }), true).tone === "bad" && standing(row({ provider: "rocket", numbers: 0 }), true).text.includes("bKash or Nagad"));
check("no job", standing(row({ kind: "off" }), true).text === "No job for this wallet.");
check("jobs off for everyone", standing(row({}), false).tone === "idle");
check("default label", defaultLabel({ provider: "rocket", kind: "crypto", threshold: 5000 }) === "Default (Crypto at Tk 5,000)");
check("what is sent: default = nulls, own choice kept", JSON.stringify(wantFor("default", "")) === JSON.stringify({ kind: null, threshold: null, problem: "" }) && wantFor("crypto", "12,000").threshold === 12000 && wantFor("crypto", "x").problem !== "");

const sql = readFileSync(new URL("../supabase/migrations/20261108_072_one_job_per_wallet.sql", import.meta.url), "utf8");
check("defaults are the owner's: bKash Taka 8,000, Nagad crypto 10,000, Rocket crypto 5,000",
  sql.includes("('bkash', 'cashin', 8000), ('nagad', 'crypto', 10000), ('rocket', 'crypto', 5000)"));
check("a crypto job only for wallets whose job is crypto", sql.includes("where w.kind = 'crypto'"));
check("a Taka job only for wallets whose job is Taka, and it comes back at once after a switch",
  sql.includes("w.kind = 'cashin'") && sql.includes("coalesce(j.note, '') <> 'switched'"));

const sql73 = readFileSync(new URL("../supabase/migrations/20261108_073_taka_job_any_number.sql", import.meta.url), "utf8");
check("a Taka job may send to any of our bKash / Nagad numbers, own type first",
  sql73.includes("where enabled and (provider = r.provider or provider in ('bkash', 'nagad'))") && sql73.includes("order by (provider = r.provider) desc, (provider = 'bkash') desc"));
check("the phone is told which kind of number it is", sql73.includes("'network', coalesce(names ->> np.provider, '')"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
