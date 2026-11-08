import { readFileSync } from "node:fs";
import { balanceLine, dayBlocks, dayTotals, dhakaTime, stateLine, type DayCheckRow, type DayMoneyRow } from "../dashboard/src/lib/dayMoney.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

const money = (o: Partial<DayMoneyRow>): DayMoneyRow => ({
  device_id: "d", provider: "bkash", account: "agent", sim_slot: 0, cash_out_n: 3, cash_out: 4131, cash_in_n: 5, cash_in: 9480,
  b2b_in_n: 0, b2b_in: 0, b2b_out_n: 1, b2b_out: 5000, received_n: 0, received: 0, sent_n: 0, sent: 0, held_n: 0, held: 0, unknown_sim_n: 0,
  from_sms: 3, from_statement: 6, from_paytrace: 0, gap_open_n: 0, gap_open: 0, checked: true, ...o,
});
const chk = (o: Partial<DayCheckRow>): DayCheckRow => ({
  device_id: "d", provider: "bkash", account: "agent", sim_slot: 0, opening: 41141.53, opening_at: "2026-11-07T17:00:00Z",
  closing: 27914.38, closing_at: "2026-11-08T08:30:00Z", next_at: "2026-11-08T18:10:00Z", reading: null, reading_at: null,
  gap_open_n: 0, gap_open: 0, gap_from: null, gap_to: null, gap_explained_n: 1, state: "complete", ...o,
});

// The owner's Vivo, 8 Nov: a quiet Nagad wallet has a balance but no movement; it still gets its block.
const blocks = dayBlocks([money({}), money({ provider: "bkash", account: "personal", sim_slot: 1 })], [chk({}), chk({ provider: "nagad" })]);
check("one block per account, agent before personal, the quiet wallet included", blocks.map((b) => b.key).join(",") === "bkash:agent,bkash:personal,nagad:agent", blocks);
check("figures and check meet in one block", blocks[0]!.money !== null && blocks[0]!.check !== null && blocks[2]!.money === null);

check("balance line: started and ended", balanceLine(chk({}), false) === "Started at Tk 41,141.53, ended at Tk 27,914.38.");
check("balance line today says now", balanceLine(chk({}), true).endsWith("now Tk 27,914.38."));
check("balance line: nothing moved", balanceLine(chk({ closing: null }), false) === "Balance Tk 41,141.53 all day (no message with a balance).");

check("complete says so and counts the statement finds", stateLine(chk({})).tone === "ok" && stateLine(chk({})).text.includes("1 move with no SMS was found in the wallet's statement"));
const miss = stateLine(chk({ state: "missing", gap_open_n: 1, gap_open: -12370.03, gap_from: "2026-11-07T18:34:00Z", gap_to: "2026-11-08T07:20:00Z" }));
check("missing names the amount, direction and the window in Bangladesh time", miss.tone === "warn" && miss.text.startsWith("Tk 12,370.03 left the wallet with no SMS between 8 Nov, 12:34 AM and 8 Nov, 1:20 PM"), miss.text);
check("waiting is neutral, running is fine", stateLine(chk({ state: "waiting" })).tone === "idle" && stateLine(chk({ state: "running" })).tone === "ok");
const diff = stateLine(chk({ state: "reading_differs", reading: 27000, reading_at: "2026-11-08T18:10:00Z", next_at: null }));
check("a balance check that differs says by how much", diff.tone === "warn" && diff.text.includes("Tk 914.38 less"), diff.text);
check("Bangladesh time", dhakaTime("2026-11-08T07:20:00Z") === "8 Nov, 1:20 PM", dhakaTime("2026-11-08T07:20:00Z"));

const t = dayTotals([money({}), money({ account: "personal", cash_out_n: 0, cash_out: 0, received_n: 2, received: 1500.5 })]);
check("headline counts the merged figures", t.cashOut.amount === 4131 && t.cashOut.n === 3 && t.received.amount === 1500.5 && t.received.n === 2, t);

// The database rules this page relies on (migration 069).
const sql = readFileSync(new URL("../supabase/migrations/20261108_069_accurate_day.sql", import.meta.url), "utf8");
check("a merchant's 'You have received' and the statement's 'Agent Cash Out' are one family", sql.includes("when p_kind in ('cash_out', 'send_money_in', 'payment_in') then 'customer_in'"));
check("a gap is explained by up to 6 entries, cash-ins with their commission", sql.includes("continue when cnt > 6 or cnt > best_cnt;") && sql.includes("slack := slack + 0.006 * abs(amts[i + 1]) + 0.5"));
check("one menu at a time on a phone", sql.includes("and r.kind in ('balance', 'cashin', 'statement', 'sendmoney')"));
check("after midnight: the statement, then a balance check", sql.includes("case when p_hour = 0 then 'day_end'") && sql.includes("values (r.device_id, 'balance', r.provider)"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
