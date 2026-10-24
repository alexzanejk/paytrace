// Agent jobs: the form rules and the text filling. Run: node --experimental-strip-types tests/jobs.test.ts
import assert from "node:assert/strict";
import { addressOf, addressProblem, agentStatus, checkAgentForm, checkJobForm, cleanWallets, fillTemplate, networkProblem, parseThreshold, takaText, validWallet, walletsFromAddress, leftoverText, transferOpen, TRANSFER_LABEL, TRANSFER_TONE } from "../dashboard/src/lib/jobs.ts";
import { readFileSync } from "node:fs";

let n = 0;
const t = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };

t("amounts: plain, with commas, decimals", () => {
  assert.equal(parseThreshold("10000"), 10000);
  assert.equal(parseThreshold("10,000"), 10000);
  assert.equal(parseThreshold(" 12500.50 "), 12500.5);
});
t("amounts: too small, too big, not a number", () => {
  for (const bad of ["", "abc", "99", "100000001", "-5", "1e5", "10.555"]) assert.equal(parseThreshold(bad), null, bad);
});
t("wallet addresses", () => {
  assert.ok(validWallet("01712345678"));
  assert.ok(validWallet("  01712345678 "));
  assert.ok(!validWallet("123"));
  assert.ok(!validWallet("0171234<script>"));
});
t("{provider} and {balance} are filled in, every time", () => {
  assert.equal(fillTemplate("Send {balance} from {provider}. {provider}!", "bkash", 12000), "Send Tk 12,000.00 from bKash. bKash!");
  assert.equal(fillTemplate("no placeholders", "nagad", 5), "no placeholders");
  assert.equal(takaText(1234.5), "Tk 1,234.50");
});
t("{agent} is filled in too", () => {
  assert.equal(fillTemplate("Hi {agent}: {provider} {balance}", "nagad", 15000, "Karim"), "Hi Karim: Nagad Tk 15,000.00");
});
t("an agent's own form: empty is fine (uses the default), bad values are named", () => {
  assert.equal(checkAgentForm({ name: "", instruction: "", urgency: "", wallet: "", network: "" }), null);
  assert.equal(checkAgentForm({ name: "Karim", instruction: "Do it", urgency: "critical", wallet: "01899999999", network: "BNB Smart Chain (BEP20)" }), null);
  assert.ok(checkAgentForm({ name: "x".repeat(41), instruction: "", urgency: "", wallet: "", network: "" }));
  assert.ok(checkAgentForm({ name: "", instruction: "", urgency: "", wallet: "12", network: "" }));
});
t("where an agent stands, in words", () => {
  const base = { jobsOn: true, agentOn: true, balance: 12000, threshold: 10000, hasWallet: true, showing: true };
  assert.equal(agentStatus(base), "Job showing now");
  assert.equal(agentStatus({ ...base, jobsOn: false }), "Jobs are off");
  assert.equal(agentStatus({ ...base, agentOn: false }), "Switched off");
  assert.equal(agentStatus({ ...base, showing: false, balance: 500 }), "Below the amount");
  assert.equal(agentStatus({ ...base, showing: false, balance: null }), "No balance yet");
  assert.equal(agentStatus({ ...base, showing: false, hasWallet: false }), "Needs a wallet address");
  assert.match(agentStatus({ ...base, showing: false }), /Marked done/);
});
const BNB = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";
t("a BNB Smart Chain (Trust Wallet) address must be 0x plus 40 letters or numbers", () => {
  assert.ok(validWallet(BNB));
  assert.ok(validWallet("  " + BNB + " "));
  for (const bad of ["0x123", BNB.slice(0, 41), BNB + "0", "0x" + "z".repeat(40)]) assert.ok(!validWallet(bad), bad);
  assert.equal(addressProblem(BNB), null);
  assert.equal(addressProblem(""), null);
  assert.match(addressProblem("0x123")!, /42 characters/);
  assert.match(addressProblem("12")!, /6 to 60/);
});
t("the network is required and short enough", () => {
  assert.equal(networkProblem("BNB Smart Chain (BEP20)"), null);
  assert.ok(networkProblem(""));
  assert.ok(networkProblem("x".repeat(61)));
});
t("one pasted address fills every wallet type, and reads back", () => {
  const w = walletsFromAddress(" " + BNB + " ");
  assert.deepEqual(Object.keys(w).sort(), ["bkash", "nagad", "rocket", "upay"]);
  assert.equal(w.nagad, BNB);
  assert.equal(addressOf(w), BNB);
  assert.deepEqual(walletsFromAddress("  "), {});
  assert.equal(addressOf({}), "");
});
t("the network migration only adds, and only admins can use the new functions", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261023_022_job_network.sql", import.meta.url), "utf8");
  assert.ok(!/\b(drop|delete)\b/i.test(sql.replace(/--.*$/gm, "")));
  assert.match(sql, /function public\.set_job_settings\([^)]*p_network text\)[\s\S]*?is_admin\(\)/);
  assert.match(sql, /function public\.set_agent_job\([^)]*p_network text\)[\s\S]*?is_admin\(\)/);
  assert.match(sql, /0x\[0-9a-fA-F\]\{40\}/);
});
t("the form: a good one passes", () => {
  assert.deepEqual(checkJobForm({ enabled: true, threshold: "10000", instruction: "Send it now", wallets: { bkash: "01711111111" } }), []);
});
t("the form: switched on needs words and a wallet", () => {
  const p = checkJobForm({ enabled: true, threshold: "10000", instruction: "  ", wallets: {} });
  assert.ok(p.some((x) => x.field === "instruction"));
  assert.ok(p.some((x) => x.field === "wallets"));
});
t("the form: switched off can be saved half empty", () => {
  assert.deepEqual(checkJobForm({ enabled: false, threshold: "10000", instruction: "", wallets: {} }), []);
});
t("the form: a bad amount or a bad wallet is named", () => {
  const p = checkJobForm({ enabled: true, threshold: "5", instruction: "x", wallets: { nagad: "12" } });
  assert.ok(p.some((x) => x.field === "threshold"));
  assert.ok(p.some((x) => x.field === "wallet" && x.provider === "nagad"));
});
t("empty wallets are dropped, others trimmed", () => {
  assert.deepEqual(cleanWallets({ bkash: " 01711111111 ", nagad: "  ", rocket: "" }), { bkash: "01711111111" });
});
t("the per-agent migration only adds, and only admins can write agent jobs", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261023_021_agent_jobs_per_agent.sql", import.meta.url), "utf8");
  assert.ok(!/\b(drop|delete)\b/i.test(sql.replace(/--.*$/gm, "")));
  assert.match(sql, /function public\.set_agent_job[\s\S]*?is_admin\(\)/);
  assert.match(sql, /function public\.set_job_settings\(p_enabled boolean, p_threshold numeric, p_instruction text, p_wallets jsonb, p_urgency text\)[\s\S]*?is_admin\(\)/);
  assert.match(sql, /revoke all on function public\.device_jobs\(uuid\) from public, anon, authenticated/);
});
t("the database migration only adds and never removes", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261023_020_agent_jobs.sql", import.meta.url), "utf8");
  assert.ok(!/\b(drop|delete)\b/i.test(sql.replace(/--.*$/gm, "")));
  assert.match(sql, /function public\.set_job_settings[\s\S]*?is_admin\(\)/);
  assert.match(sql, /grant execute on function public\.device_jobs\(uuid\) to service_role/);
  assert.match(sql, /revoke all on function public\.device_jobs\(uuid\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.device_job_done\(uuid, text\) to service_role/);
});
t("sent-money check: wording for the leftover", () => {
  assert.equal(leftoverText(null), "–");
  assert.equal(leftoverText(0), "fits");
  assert.equal(leftoverText(120), "+120 Tk");
  assert.equal(leftoverText(-4.5), "−4.5 Tk");
});
t("sent-money check: the owner can settle only open ones, and every status has words and a colour", () => {
  for (const s of ["checking", "mismatch", "review"] as const) assert.ok(transferOpen(s));
  for (const s of ["verified", "rejected"] as const) assert.ok(!transferOpen(s));
  for (const s of ["checking", "mismatch", "review", "verified", "rejected"] as const) assert.ok(TRANSFER_LABEL[s] && TRANSFER_TONE[s]);
});
t("sent-money migration: only adds, owner-only settling, phone functions are service-role only, never blocks a payment", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261023_024_job_transfers.sql", import.meta.url), "utf8");
  assert.ok(!/\b(drop|delete)\b/i.test(sql.replace(/--.*$/gm, "")));
  assert.match(sql, /function public\.resolve_job_transfer[\s\S]*?is_admin\(\)/);
  assert.match(sql, /revoke all on function public\.device_job_sent\(uuid, text, numeric, numeric\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.device_job_fix\(uuid, uuid, numeric, numeric\) to service_role/);
  assert.match(sql, /alter table public\.job_transfers enable row level security/);
  assert.match(sql, /exception when others then\s+return new/);
  assert.match(sql, /coalesce\(p_pay\.commission, 0\) > 0/);
});
t("earnings-month migration only replaces the two phone functions, keeps them service-role only", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261024_025_earnings_month_paid.sql", import.meta.url), "utf8");
  assert.ok(!/\b(drop|delete)\b/i.test(sql.replace(/--.*$/gm, "")));
  assert.match(sql, /revoke all on function public\.device_earnings\(uuid\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.device_jobs\(uuid\) to service_role/);
  assert.match(sql, /paid_on >= today - 2/);
  assert.match(sql, /status = 'rejected' and coalesce\(t\.checked_at, t\.submitted_at\) > now\(\) - interval '12 hours'/);
});

console.log(`\n${n} checks passed`);
