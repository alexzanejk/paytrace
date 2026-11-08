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

const sql75 = readFileSync(new URL("../supabase/migrations/20261108_075_job_stays_until_done.sql", import.meta.url), "utf8");
const sync75 = sql75.slice(sql75.indexOf("function public.cashin_sync"), sql75.indexOf("function public.remove_cashin_number"));
check("a shown Taka job is no longer cancelled when the balance falls (only a switch or jobs off cancels it)",
  sync75.includes("(not s.enabled or (select w.kind from public.wallet_job_of(j.device_id, j.provider) w) <> 'cashin')") && !sync75.slice(0, sync75.indexOf("if not s.enabled then return")).includes("device_balances"));
check("a crypto job is remembered once shown and the phone list reads that memory", sql75.includes("create table if not exists public.job_shown") && sql75.includes("from public.job_shown js") && sql75.includes("perform public.crypto_job_sync(p_device)"));
check("the typed amount may be up to the balance the job was shown at", sql75.includes("greatest(b.balance, j.balance)") && sql75.includes("greatest(b.balance, coalesce(js.balance, 0))"));
check("a Cash In / Send Money message of exactly that amount, after the job was shown, verifies it",
  sql75.includes("p.review_reason in ('cash_in_sent', 'send_money_sent')") && sql75.includes("p.amount = p_amount") && sql75.includes("create trigger payments_job_outflow_check"));
check("one message can prove only one job", sql75.includes("not exists (select 1 from public.cashin_jobs j where j.payment_id = p.id)") && sql75.includes("not exists (select 1 from public.job_transfers t where t.payment_id = p.id)"));
check("no DROP or DELETE (the MCP hangs on them)", !/\b(drop|delete)\b/i.test(sql75.replace(/--[^\n]*/g, "")));

const sql76 = readFileSync(new URL("../supabase/migrations/20261108_076_job_cost_note.sql", import.meta.url), "utf8");
check("every submission and fix can carry the partner's other cost and what it was for",
  ["device_cashin_sent", "device_cashin_fix", "device_job_sent", "device_job_fix"].every((f) => sql76.includes(`function public.${f}(`) && sql76.includes("p_cost numeric, p_cost_note text")));
check("the cost is for the owner to read: the six-argument versions call the old check unchanged",
  sql76.includes("r := public.device_cashin_sent(p_device, p_provider, p_amount, p_commission);") && sql76.includes("r := public.device_job_sent(p_device, p_provider, p_amount, p_charge);"));
check("the partner's own list shows the cost and its note", sql76.includes("'cost', t.cost, 'cost_note', t.cost_note") && sql76.includes("'cost', c.cost, 'cost_note', c.cost_note"));
check("076: no DROP or DELETE", !/\b(drop|delete)\b/i.test(sql76.replace(/--[^\n]*/g, "")));
const ingest = readFileSync(new URL("../supabase/functions/ingest/index.ts", import.meta.url), "utf8");
check("the ingest function passes cost and its note on all four actions", (ingest.match(/\.\.\.extra \}\)/g) ?? []).length === 4 && ingest.includes("function costOf("));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
