import { readFileSync } from "node:fs";
import { changedRates, commissionOf, fmtPct, owedOf, parseRate, ratesOn, rateKey, sumDays, type RateRow } from "../dashboard/src/lib/commission.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

// ---- rates: the newest rate that has started wins; other phones' rates never leak in ----
const rows: RateRow[] = [
  { device_id: "A", provider: "bkash", kind: "cash_out", rate_pct: 4, effective_from: "2026-10-01" },
  { device_id: "A", provider: "bkash", kind: "cash_out", rate_pct: 5, effective_from: "2026-10-20" },
  { device_id: "A", provider: "bkash", kind: "cash_out", rate_pct: 6, effective_from: "2026-10-30" },
  { device_id: "A", provider: "nagad", kind: "send_money", rate_pct: 3, effective_from: "2026-10-10" },
  { device_id: "B", provider: "bkash", kind: "cash_out", rate_pct: 9, effective_from: "2026-10-01" },
];
const key = rateKey("bkash", "cash_out");
check("before any rate starts there is no rate", ratesOn(rows, "A", "2026-09-30").size === 0);
check("the first rate applies from its day", ratesOn(rows, "A", "2026-10-01").get(key) === 4);
check("a later rate replaces it from its own day", ratesOn(rows, "A", "2026-10-20").get(key) === 5 && ratesOn(rows, "A", "2026-10-19").get(key) === 4);
check("a rate that starts in the future is not used yet", ratesOn(rows, "A", "2026-10-25").get(key) === 5);
check("each provider and kind has its own rate", ratesOn(rows, "A", "2026-10-25").get(rateKey("nagad", "send_money")) === 3 && ratesOn(rows, "A", "2026-10-25").get(rateKey("nagad", "cash_out")) === undefined);
check("another phone's rate does not apply", ratesOn(rows, "A", "2026-10-25").get(key) === 5 && ratesOn(rows, "B", "2026-10-25").get(key) === 9);

// ---- typed rates ----
check("whole and decimal rates are accepted", parseRate("4").ok && parseRate("4.5").ok && parseRate(" 0 ").ok && parseRate("100").ok && parseRate("12.25").ok);
check("bad rates are refused", ["", "abc", "4,5", "-1", "101", "4.555", "1000", ".5", "4%"].every((t) => !parseRate(t).ok));
check("percent text", fmtPct(4) === "4%" && fmtPct(4.5) === "4.5%" && fmtPct(12.25) === "12.25%");

// ---- the grid only sends what changed ----
const now = new Map([[rateKey("bkash", "cash_out"), 5]]);
let g = changedRates(now, { [rateKey("bkash", "cash_out")]: "5", [rateKey("nagad", "cash_out")]: "4" });
check("an unchanged rate is not sent, a new one is", g.changes.length === 1 && g.changes[0].provider === "nagad" && g.changes[0].rate === "4");
g = changedRates(now, { [rateKey("bkash", "cash_out")]: "5.0" });
check("5 and 5.0 are the same rate", g.changes.length === 0);
g = changedRates(now, { [rateKey("upay", "send_money")]: "" });
check("a blank box means leave as it is", g.changes.length === 0 && g.invalid.length === 0);
g = changedRates(now, { [rateKey("upay", "send_money")]: "0" });
check("0 is a real rate (stops commission)", g.changes.length === 1 && g.changes[0].rate === "0");
g = changedRates(now, { [rateKey("upay", "send_money")]: "abc", [rateKey("nagad", "send_money")]: "3" });
check("an invalid box is reported and the valid one still goes", g.invalid.length === 1 && g.changes.length === 1);

// ---- commission and balances ----
check("4% of 10,000 is 400", commissionOf(10000, 4) === 400);
check("5% of 4,000 is 200", commissionOf(4000, 5) === 200);
check("rounds to 2 decimals like the database", commissionOf(333.33, 4.5) === 15 && commissionOf(0.01, 4) === 0);
const s = sumDays([{ total: 10000, commission: 400, n: 2 }, { total: 5000, commission: 150, n: 1 }]);
check("day rows add up", s.total === 15000 && s.commission === 550 && s.n === 3);
check("nothing owed once paid in full", owedOf(850, 850).owed === 0 && owedOf(850, 850).over === 0);
check("owed is earned minus paid", owedOf(850, 300).owed === 550);
check("an overpayment is reported, not hidden", owedOf(100, 130).owed === 0 && owedOf(100, 130).over === 30);

// ---- the migration only adds (the Supabase tool cannot run statements with these words) ----
const sql = readFileSync(new URL("../supabase/migrations/20261023_019_partner_commission.sql", import.meta.url), "utf8");
check("migration 019 has no drop or delete", !/\b(drop|delete)\b/i.test(sql));
check("the earnings function is service-role only", /revoke all on function public\.device_earnings\(uuid\) from public, anon, authenticated;\s*grant execute on function public\.device_earnings\(uuid\) to service_role;/.test(sql));
check("every admin function checks is_admin", ["set_device_earnings_visible", "set_commission_rates", "add_commission_payout", "void_commission_payout"].every((f) => {
  const i = sql.indexOf(`function public.${f}(`);
  return i > 0 && sql.slice(i, i + 700).includes("public.is_admin()");
}));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
