import { searchQuery, maskNumber, readSearch, outcomeWords, searchPhones, searchTargets, queueErrorText } from "../dashboard/src/lib/appSearch.ts";

let failed = 0;
const check = (name: string, ok: boolean, got?: unknown) => {
  if (!ok) { failed++; console.error("FAIL", name, got ?? ""); } else console.log("ok  ", name);
};

check("a TrxID is upper-cased", JSON.stringify(searchQuery(" dkb6ccn518 ")) === JSON.stringify({ query: "DKB6CCN518", kind: "trx" }));
check("a number in any form", ["01322784471", "+8801322784471", "8801322784471", "0132-278 4471"].every((s) => searchQuery(s)?.query === "01322784471" && searchQuery(s)?.kind === "phone"));
check("junk is refused", [null, "", "12345678", "DK*1;", "short"].every((s) => searchQuery(s as string) === null));
check("numbers are hidden like bKash does", maskNumber("01322784471") === "0132XXXX471" && maskNumber("0187XXXX371") === "0187XXXX371");

const found = readSearch([
  "bKash app search\nquery: DKB6CCN518\noutcome: found\nfound: 1\nrow: Cash Out · 01870000371 · 01:16pm 11/11/26 · + ৳2,000 · Commission: + ৳8\nsheet: Cash Out · Close · DKB6CCN518\nrows: 1, sent: 1",
  "Cash Out | 0187XXXX371 | 01:16pm 11/11/26 | + ৳2,000 | Commission: + ৳8",
]);
check("a found answer is read", !!found && found.found && found.query === "DKB6CCN518" && found.rows.length === 1 && found.sheet.includes("DKB6CCN518"));
check("found says found", outcomeWords(found!, "trx").tone === "ok");
const none = readSearch(["bKash app search\nquery: DKB6CCN518\noutcome: nothing found\nfound: 0"])!;
check("nothing found is never called proof", !none.found && outcomeWords(none, "trx").text.includes("does not prove"));
check("no rows for a number is plain", outcomeWords({ ...none, query: "01322784471" }, "phone").tone === "idle");
check("an empty list is a retry", outcomeWords({ ...none, outcome: "list did not load" }, "trx").text.includes("Try again"));
check("an app read is not a search answer", readSearch(["bKash app transactions\npackage: x"]) === null && readSearch(null) === null);

const now = Date.parse("2026-11-11T10:00:00Z");
const phones = searchPhones([
  { id: "a", name: "Vivo", status: "approved", last_seen_at: "2026-11-11T09:59:50Z", info: { app_search: true } },
  { id: "b", name: "Old", status: "approved", last_seen_at: "2026-11-11T09:59:50Z", info: {} },
  { id: "c", name: "Away", status: "approved", last_seen_at: "2026-11-11T09:00:00Z", info: { app_search: true } },
  { id: "d", name: "Gone", status: "revoked", info: { app_search: true } },
], now);
check("only phones that can search, online first", phones.map((p) => p.id).join() === "a,c" && phones[0].online && !phones[1].online);
check("auto picks the phone the SMS came to", searchTargets("auto", phones, "c").join() === "c");
check("auto without a known phone asks them all", searchTargets("auto", phones, null).join() === "a,c" && searchTargets("auto", phones, "b").join() === "a,c");
check("a chosen phone only", searchTargets("c", phones, "a").join() === "c" && searchTargets("zz", phones, null).length === 0);
check("all is all", searchTargets("all", phones, "c").join() === "a,c");
check("refusals in words", queueErrorText("app_not_ready").includes("Update") && queueErrorText("bad_query").includes("TrxID"));

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("\nall passed");
