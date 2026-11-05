import { DEFAULT_OFFLINE_AFTER_SEC, isChosen, mainNumbers, planLine, sitePlan, unchosenCount, type NumberDevice, type NumberWallet, type SiteAssignment } from "../dashboard/src/lib/siteNumbers.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}
const now = Date.parse("2026-11-05T10:00:00Z");
const devices: NumberDevice[] = [
  { id: "D1", name: "Vivo", status: "approved", last_seen_at: "2026-11-05T09:59:40Z" },
  { id: "D2", name: "Xiaomi", status: "approved", last_seen_at: "2026-11-05T08:00:00Z" },
  { id: "D3", name: "Old Vivo", status: "revoked", last_seen_at: "2026-11-05T09:59:50Z" },
  { id: "D4", name: "Partner Rubel", status: "approved", last_seen_at: "2026-11-05T09:59:50Z", default_group: "dvw9166" },
];
const wallets: NumberWallet[] = [
  { id: "W1", device_id: "D1", provider: "nagad", wallet_number: "01711111111", method: "cash_out", enabled: true, wallet_group: "main" },
  { id: "W2", device_id: "D2", provider: "nagad", wallet_number: "01722222222", method: "cash_out", enabled: true, wallet_group: "main" },
  { id: "W3", device_id: "D1", provider: "bkash", wallet_number: "01733333333", method: "send_money", enabled: true, wallet_group: "main" },
  { id: "W4", device_id: "D3", provider: "bkash", wallet_number: "01744444444", method: "cash_out", enabled: true, wallet_group: "main" },
  { id: "W5", device_id: "D4", provider: "nagad", wallet_number: "01755555555", method: "cash_out", enabled: true, wallet_group: "dvw9166" },
  { id: "W6", device_id: "D2", provider: "rocket", wallet_number: "01766666666", method: "cash_out", enabled: false, wallet_group: "main" },
];
const nums = mainNumbers(wallets, devices, now);
check("only main, approved, switched-on numbers", nums.map((n) => n.id).join(",") === "W3,W1,W2", nums.map((n) => n.id));
check("sorted bKash before Nagad, then by phone name", nums[0].provider === "bkash" && nums[1].deviceName === "Vivo" && nums[2].deviceName === "Xiaomi");
check("online from the phone's last heartbeat", nums[1].online === true && nums[2].online === false);

const asg: SiteAssignment[] = [
  { api_key_id: "S1", wallet_id: "W2", enabled: true },
  { api_key_id: "S1", wallet_id: "W1", enabled: false },
  { api_key_id: "S2", wallet_id: "W1", enabled: true },
  { api_key_id: "S2", wallet_id: "W2", enabled: true },
];
check("chosen means an enabled row", isChosen(asg, "S1", "W2") && !isChosen(asg, "S1", "W1") && !isChosen(asg, "S3", "W1"));

const p1 = sitePlan("S1", nums, asg);
check("one entry per wallet type", p1.map((e) => `${e.provider}/${e.method}`).join(",") === "bkash/send_money,nagad/cash_out");
check("site 1 chose the Xiaomi Nagad number only", p1[1].fallback === false && p1[1].numbers.map((n) => n.id).join() === "W2");
check("site 1 chose no bKash number: fallback to any", p1[0].fallback === true && p1[0].numbers.length === 1);
check("plan line, chosen", planLine(p1[1]) === "Nagad · Cash Out (agent): 01722222222", planLine(p1[1]));
check("plan line, fallback", planLine(p1[0]).startsWith("bKash · Send Money: not chosen, any main number may show"));
const p2 = sitePlan("S2", nums, asg);
check("two chosen numbers rotate", planLine(p2[1]) === "Nagad · Cash Out (agent): 01711111111, 01722222222 (in turn)", planLine(p2[1]));
check("default offline threshold matches the dashboard's", DEFAULT_OFFLINE_AFTER_SEC === 90);
check("unchosen count", unchosenCount(p1) === 1 && unchosenCount(sitePlan("S9", nums, asg)) === 2);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
