import { clampRange, filterMovements, groupOf, kindLabel, matchesTerm, totals, type Movement } from "../dashboard/src/lib/movements.ts";

let failed = 0;
const check = (name: string, ok: boolean, got?: unknown) => {
  if (!ok) { failed++; console.error("FAIL", name, got ?? ""); } else console.log("ok  ", name);
};

const m = (o: Partial<Movement>): Movement => ({
  at: "2026-11-12T05:00:00Z", exact_time: true, day: "2026-11-12", device_id: "vivo", provider: "bkash", account: "agent",
  kind: "cash_out", amount: 500, commission: null, balance: null, trx_id: null, counterparty: null, status: "tracked_only",
  review_reason: null, chain_status: null, seen: "sms", payment_id: null, raw: null, ...o,
});

check("Rocket's customer cash-out is called B2C", kindLabel("cash_out", "rocket").startsWith("B2C Cash Out"));
check("bKash's is a plain Cash Out", kindLabel("cash_out", "bkash") === "Cash Out (customer)");
check("cash-ins sent and received are one group", groupOf("cash_in_sent") === "cash_in" && groupOf("cash_in_received") === "cash_in");
check("both B2B directions are one group", groupOf("b2b_in") === "b2b" && groupOf("b2b_out") === "b2b");
check("an unknown kind falls in Other", groupOf("something") === "other");

const rows = [
  m({ trx_id: "DKB1CVD04L", counterparty: "0196XXXX237" }),
  m({ kind: "cash_in_sent", amount: -1000, seen: "wallet", counterparty: "0173XXXX653", device_id: "rubel" }),
  m({ kind: "b2b_out", amount: -5000, seen: "paytrace", provider: "nagad" }),
  m({ kind: "b2b_in", amount: 7000, seen: "wallet", provider: "rocket" }),
];
check("filter by phone", filterMovements(rows, { device: "rubel" }).length === 1);
check("filter by wallet", filterMovements(rows, { provider: "nagad" }).length === 1);
check("filter by type group", filterMovements(rows, { group: "b2b" }).length === 2);
check("filter by direction", filterMovements(rows, { direction: "out" }).length === 2 && filterMovements(rows, { direction: "in" }).length === 2);
check("filter by where seen", filterMovements(rows, { seen: "wallet" }).length === 2);
check("all = no filter", filterMovements(rows, { device: "all", provider: "all", group: "all", direction: "all", seen: "all" }).length === 4);

check("a TrxID is found by any part", matchesTerm(rows[0], "cvd04") && !matchesTerm(rows[1], "cvd04"));
check("a full number finds its masked form", matchesTerm(rows[1], "01735123653") && !matchesTerm(rows[1], "01799999999"));
check("a Nagad-style mask works too", matchesTerm(m({ counterparty: "017****5537" }), "01712345537"));
check("an empty search keeps everything", matchesTerm(rows[2], "  "));

const t = totals(rows);
check("money in and out", t.moneyIn === 7500 && t.moneyOut === 6000, t);
check("rows with no SMS are counted", t.noSms === 3);
check("counts per group", t.byGroup.b2b.n === 2 && t.byGroup.cash_out.n === 1 && t.byGroup.cash_in.n === 1);

check("31 days or less is kept", !clampRange("2026-10-12", "2026-11-12").clamped);
const c = clampRange("2026-09-01", "2026-11-12");
check("a longer period keeps its last 31 days", c.clamped && c.from === "2026-10-12" && c.to === "2026-11-12", c);

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log(`\n${19} passed, 0 failed`);
