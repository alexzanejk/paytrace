import { PLAN_WORDS, planLine, plannedByPayment, preferredSender, queuePositions, recentPlans, type PayoutPlan } from "../dashboard/src/lib/payoutPlans.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}
const plan = (over: Partial<PayoutPlan>): PayoutPlan => ({
  id: "p", label: "t9ceff6182", tg_user_id: 1, payment_ids: ["a"], count: 1, total: 500, device_id: "d1", provider: "bkash", from_account: "agent", account: null,
  via: "ussd", to_number: "01722222222", keep_pct: 20, note: null, status: "queued", payout_id: null, error: null, created_at: "2026-11-20T10:00:00Z", started_at: null, finished_at: null, ...over,
});
const now = new Date("2026-11-20T12:00:00Z");
check("every status has words", (Object.keys(PLAN_WORDS) as Array<keyof typeof PLAN_WORDS>).length === 6 && PLAN_WORDS.unsure.tone === "warn");
check("plan line", planLine(plan({ count: 3, total: 1500 }), () => "Vivo") === "t9ceff6182 · 3 transactions, Tk 1,500.00 · to 01722222222 · from Vivo" && planLine(plan({ via: "app" }), () => "Vivo").endsWith("(app)"));
const list = [
  plan({ id: "q2", status: "queued", created_at: "2026-11-20T10:02:00Z" }),
  plan({ id: "q1", status: "queued", created_at: "2026-11-20T10:01:00Z" }),
  plan({ id: "q3", status: "queued", device_id: "d2", created_at: "2026-11-20T10:03:00Z" }),
  plan({ id: "s", status: "sending", created_at: "2026-11-20T10:00:00Z" }),
  plan({ id: "u", status: "unsure", created_at: "2026-11-19T10:00:00Z" }),
  plan({ id: "old", status: "paid", created_at: "2026-11-18T10:00:00Z", finished_at: "2026-11-18T10:01:00Z" }),
  plan({ id: "new", status: "failed", created_at: "2026-11-20T09:00:00Z", finished_at: "2026-11-20T09:01:00Z" }),
];
const recent = recentPlans(list, now);
check("recent: live and today's ended plans, unsure first, old paid left out", recent.map((p) => p.id).join(",") === "u,s,q3,q2,q1,new");
const pos = queuePositions(list);
check("queue positions per phone, in the order queued", pos.get("q1") === 1 && pos.get("q2") === 2 && pos.get("q3") === 1 && !pos.has("s"));
check("planned transactions carry the plan label", plannedByPayment([plan({ payment_ids: ["a", "b"] }), plan({ id: "x", status: "paid", payment_ids: ["c"] })]).get("b") === "t9ceff6182" && !plannedByPayment(list.slice(5)).has("a"));
const options = [
  { key: "d2:bkash:agent", deviceId: "d2", provider: "bkash", account: "agent", why: "" },
  { key: "d1:nagad:agent", deviceId: "d1", provider: "nagad", account: "agent", why: "" },
  { key: "d1:bkash:agent", deviceId: "d1", provider: "bkash", account: "agent", why: "switched off" },
];
check("preferred sender = the wallet that received most, if it can send", preferredSender(options, [{ device_id: "d1", provider: "nagad" }, { device_id: "d1", provider: "nagad" }, { device_id: "d2", provider: "bkash" }])?.key === "d1:nagad:agent");
check("a wallet that cannot send is skipped for the next best", preferredSender(options, [{ device_id: "d1", provider: "bkash" }])?.key === "d2:bkash:agent");
check("with no phone known, the wallet type alone picks the sender", preferredSender(options, [{ provider: "nagad" }])?.key === "d1:nagad:agent");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
