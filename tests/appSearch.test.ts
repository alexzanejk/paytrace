import { searchQuery, maskNumber, nagadMask, readSearch, outcomeWords, searchPhones, searchTargets, queueErrorText, SEARCH_RPC, bestPhone, planSearch, phoneChoices } from "../dashboard/src/lib/appSearch.ts";

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

// ---- The Nagad agent app (migration 093) ----
{
  const devs = [
    { id: "n", name: "Vivo", status: "approved", last_seen_at: new Date().toISOString(), info: { app_search: true, app_nagad: true } },
    { id: "b", name: "Old", status: "approved", last_seen_at: new Date().toISOString(), info: { app_search: true } },
  ];
  check("only phones that can drive the Nagad app search it", searchPhones(devs, Date.now(), "nagad").map((p) => p.id).join() === "n");
  check("bKash search still asks both", searchPhones(devs, Date.now(), "bkash").length === 2);
  check("a Nagad search goes to its own queue", SEARCH_RPC.nagad === "queue_nagad_search" && SEARCH_RPC.bkash === "queue_app_search");
  check("a Nagad answer is read like a bKash one", readSearch(["Nagad app search\nquery: 76AUQR5I\noutcome: found\nrow: ক্যাশ আউট · 018XXXX8710 · 09:43 PM 11/11/26 · ৳500 · 76AUQR5I"])?.found === true);
  check("Nagad hides a number its own way", nagadMask("01883718710") === "018****8710");
}

{
  // Owner 2026-11-12: "best phone chooses the wrong phone sometimes instead of the phone where the message arrived".
  // Real cases: a Nagad TrxID (76AY0A8N, SMS on the Vivo) was searched in the bKash app of three phones, and a bKash
  // TrxID whose SMS reached rubel's phone was asked of the Xiaomi and the Vivo instead.
  const name = (id: string) => ({ vivo: "Vivo", rubel: "rubel", xi: "Xiaomi" } as Record<string, string>)[id] ?? id;
  const p = (id: string) => ({ id, name: name(id), online: true });
  const nagadSms = bestPhone([{ device_id: "vivo", provider: "nagad" }], []);
  check("the SMS phone and the SMS's own wallet win", nagadSms.deviceId === "vivo" && nagadSms.app === "nagad" && nagadSms.why === "sms");
  const plan = planSearch("auto", [p("xi"), p("vivo"), p("rubel")], nagadSms, name);
  check("auto asks only the phone the SMS arrived on", plan.targets.join() === "vivo" && plan.note.includes("SMS arrived"));
  const rubelSms = bestPhone([{ device_id: "rubel", provider: "bkash" }], [{ device_id: "vivo", provider: "bkash" }]);
  check("the SMS phone beats the order's phone", rubelSms.deviceId === "rubel");
  const stuck = planSearch("auto", [p("xi"), p("vivo")], rubelSms, name);
  check("auto never quietly asks other phones when the right one cannot search", stuck.targets.length === 0 && stuck.problem.includes("rubel") && stuck.problem.includes("update"));
  const typedOnly = bestPhone([], [{ device_id: "vivo", provider: "bkash" }]);
  check("no SMS: the phone shown on the customer's order", typedOnly.deviceId === "vivo" && typedOnly.why === "order");
  check("unknown everywhere: everyone is asked", planSearch("auto", [p("xi"), p("vivo")], bestPhone([], []), name).targets.join() === "xi,vivo");
  check("a chosen phone is asked alone", planSearch("xi", [p("xi"), p("vivo")], nagadSms, name).targets.join() === "xi");
  check("a chosen phone that cannot search is refused, not swapped", planSearch("rubel", [p("xi")], nagadSms, name).targets.length === 0);
  check("all asks all", planSearch("all", [p("xi"), p("vivo")], nagadSms, name).targets.join() === "xi,vivo");
  check("a row with no phone or wallet is skipped", bestPhone([{ device_id: null, provider: "bkash" }, { device_id: "x", provider: "rocket" }, { device_id: "vivo", provider: "bkash" }], []).deviceId === "vivo");
  const devs = [
    { id: "a", name: "A", status: "approved", info: { app_search: true } },
    { id: "b", name: "B", status: "approved", info: {} },
    { id: "c", name: "C", status: "revoked", info: { app_search: true } },
  ];
  const ch = phoneChoices(devs, Date.now(), "bkash");
  check("every approved phone is listed, the ones that can search marked", ch.map((x) => `${x.id}${x.canSearch ? "+" : "-"}`).join() === "a+,b-");
}

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("\nall passed");
