import { readFileSync } from "node:fs";
import { DEFAULT_MIN_DEPOSIT, LOWEST_MIN_DEPOSIT, depositRange, minDepositLine, parseMinDeposit } from "../dashboard/src/lib/minDeposit.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

// The setting on a website's card (owner 2026-11-14): 500 by default, down to 100 for chosen sites.
check("defaults match the database", DEFAULT_MIN_DEPOSIT === 500 && LOWEST_MIN_DEPOSIT === 100);
check("100, 250 and 500 are accepted", parseMinDeposit("100") === 100 && parseMinDeposit("250") === 250 && parseMinDeposit("500") === 500);
check("Tk, commas, spaces and Bangla digits are read", parseMinDeposit("Tk 1,00") === 100 && parseMinDeposit("২০০") === 200 && parseMinDeposit(" 300 ") === 300);
check("under 100 is refused", parseMinDeposit("99") === null && parseMinDeposit("0") === null);
check("over 500 is refused (raising it is not a per-site choice)", parseMinDeposit("501") === null && parseMinDeposit("1000") === null);
check("decimals, negatives and words are refused", parseMinDeposit("150.5") === null && parseMinDeposit("-200") === null && parseMinDeposit("abc") === null && parseMinDeposit("") === null);
check("the range in words", depositRange(100) === "100 to 50,000 taka" && depositRange(undefined) === "500 to 50,000 taka");
check("the usual minimum says so", /usual minimum/.test(minDepositLine(500)));
check("a lowered site says it, and that USDT counts too", /from 100 taka \(USDT too\)/.test(minDepositLine(100)) && /Other sites stay at 500/.test(minDepositLine(100)));

// The developer brief copied from a site's card names that site's own minimum.
// (apiDocs imports the dashboard's own paths, so it is read as text here rather than run.)
const docs = readFileSync(new URL("../dashboard/src/lib/apiDocs.ts", import.meta.url), "utf8");
const card = readFileSync(new URL("../dashboard/src/components/SiteCard.tsx", import.meta.url), "utf8");
check("the brief takes the site's minimum, 500 when not given", /depositInstructions\(key\?: string, minDeposit = 500\)/.test(docs) && docs.includes("from ${minDeposit} to 50000 taka"));
check("the card copies the brief with its own minimum", /depositInstructions\(undefined, site\.min_deposit/.test(card));

// The migration keeps the database's rule in step: 100 floor, 500 default, both makers patched, nothing removed.
const sql = readFileSync(new URL("../supabase/migrations/20261114_100_site_min_deposit.sql", import.meta.url), "utf8");
check("migration: default 500, floor 100", /min_deposit integer not null default 500/.test(sql) && /min_deposit between 100 and 500/.test(sql));
check("migration: both deposit makers use the site's minimum", /'gw_create_deposit', 'gw_create_crypto_deposit'/.test(sql) && /gw_min_deposit\(kid\)/.test(sql));
check("migration: only an admin may change it", /if not public\.is_admin\(\) then raise exception 'not allowed'/.test(sql));
check("migration: no DROP or DELETE (the MCP hangs on them)", !/\b(drop|delete)\b/i.test(sql));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
