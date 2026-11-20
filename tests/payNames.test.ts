import { cleanName, nameOf, nameSource, namesAmong, namesById, safeNameTerm, type PaymentName } from "../dashboard/src/lib/payNames.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

check("a typed name is trimmed, inner spaces folded, capped at 64", cleanName("  tom  zone 007  ") === "tom zone 007" && cleanName("x".repeat(80)).length === 64 && cleanName("   ") === "");
const rows: PaymentName[] = [
  { payment_id: "a", name: "t9ceff6182", source: "telegram", tg_user_id: 1 },
  { payment_id: "b", name: "rifat_vai", source: "owner" },
  { payment_id: "c", name: null, source: "telegram" },
];
const m = namesById(rows);
check("rows without a name are left out of the map", m.size === 2 && !m.has("c"));
check("the origin reads from Telegram / set by you / nothing", nameSource(m.get("a")) === "from Telegram" && nameSource(m.get("b")) === "set by you" && nameSource(undefined) === "" && nameSource(rows[2]) === "");
check("nameOf is the name or empty", nameOf(m, "a") === "t9ceff6182" && nameOf(m, "zzz") === "");
check("namesAmong lists each distinct name once, in tick order", JSON.stringify(namesAmong(m, ["b", "a", "c", "b"])) === JSON.stringify(["rifat_vai", "t9ceff6182"]));
check("the search term for a name keeps login characters and drops the rest", safeNameTerm(" tom_zone.007 <script> ") === "tom_zone.007 script" && safeNameTerm("@cra_zy1").startsWith("@"));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
