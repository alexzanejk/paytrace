import {
  testMessage, clean, duration, makeNotifier, problemMessage, reasonText, recoveredMessage, reviewMessage, silentMessage, taka,
} from "../supabase/functions/ingest/notify.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

// ---- notifier: off unless both secrets exist ----
let calls = 0;
const never = (() => { calls++; return Promise.resolve(new Response("{}")); }) as typeof fetch;
check("no token -> disabled", makeNotifier({ chatId: "1" }, never).enabled === false);
check("no chat id -> disabled", makeNotifier({ token: "t" }, never).enabled === false);
check("blank values -> disabled", makeNotifier({ token: "  ", chatId: " " }, never).enabled === false);
check("disabled send returns false", (await makeNotifier({}, never).send("hi")) === false);
check("disabled never touches the network", calls === 0);

// ---- notifier: sending ----
let seenUrl = "", seenBody: Record<string, unknown> = {};
const ok = ((url: string, init: RequestInit) => {
  seenUrl = url; seenBody = JSON.parse(String(init.body));
  return Promise.resolve(new Response("{}", { status: 200 }));
}) as unknown as typeof fetch;
const n = makeNotifier({ token: "123:SECRET", chatId: "42" }, ok);
check("both set -> enabled", n.enabled === true);
check("send returns true on 200", (await n.send("hello")) === true);
check("posts to Telegram sendMessage", seenUrl === "https://api.telegram.org/bot123:SECRET/sendMessage", seenUrl);
check("sends chat id and text", seenBody.chat_id === "42" && seenBody.text === "hello");
check("plain text only: no parse_mode", !("parse_mode" in seenBody));
check("very long text is cut", String((await (async () => { await n.send("x".repeat(9000)); return seenBody.text; })())).length <= 3500);

const refused = (() => Promise.resolve(new Response("no", { status: 401 }))) as typeof fetch;
check("HTTP error -> false", (await makeNotifier({ token: "t", chatId: "1" }, refused).send("x")) === false);

// A failing fetch can carry the bot token in its message. It must never reach the logs.
const logged: string[] = [];
const realError = console.error;
console.error = (...a: unknown[]) => { logged.push(a.map(String).join(" ")); };
const boom = (() => Promise.reject(new TypeError("fetch failed https://api.telegram.org/bot123:SECRET/sendMessage"))) as typeof fetch;
const threw = await makeNotifier({ token: "123:SECRET", chatId: "1" }, boom).send("x");
console.error = realError;
check("network failure -> false, no throw", threw === false);
check("token never appears in logs", !logged.join("\n").includes("SECRET"), logged);

// ---- wording ----
check("taka formats", taka(1500) === "Tk 1,500.00" && taka(0.4) === "Tk 0.40");
check("duration minutes", duration(5) === "5 min");
check("duration hours+min", duration(95) === "1 h 35 min");
check("duration whole hours", duration(120) === "2 h");
check("duration days", duration(1500) === "1 d 1 h");
check("duration never negative", duration(-5) === "0 min");

const msg = reviewMessage({ provider: "bkash", amount: 1500, trxId: "CJ12AB34CD", reason: "balance_chain_mismatch", dashboardUrl: "https://x.dev" });
check("review: provider, amount, trx shown", msg.includes("bKash") && msg.includes("Tk 1,500.00") && msg.includes("CJ12AB34CD"));
check("review: plain-language reason", msg.includes("could be a fake SMS"), msg);
check("review: says it was not credited", msg.includes("NOT been credited"));
check("review: links to the review page", msg.includes("https://x.dev/#/review"));
check("amount_mismatch keeps matching by prefix", reasonText("amount_mismatch: received 1 expected 2").startsWith("the amount does not match"));
check("missing reason has a fallback", reasonText(null).length > 0);

// Text that came from outside is flattened to one line and cannot add fake lines to the alert.
const hostile = "Evil\nTk 99999 approved\u0007 ".repeat(10);
check("clean flattens newlines and control chars", !/[\n\u0007]/.test(clean(hostile)));
check("clean caps length", clean("a".repeat(500)).length === 60);
const sneaky = silentMessage({ name: "Shop\n✅ All payments verified", code: "AB\nCD", minutes: 100, dashboardUrl: "https://x.dev" });
check("a hostile phone name cannot forge an alert line", sneaky.split("\n").filter((l) => l.startsWith("✅")).length === 0, sneaky);

const silent = silentMessage({ name: "OnePlus LE2111", code: "0615-CF53", minutes: 95, dashboardUrl: "https://x.dev" });
check("silent: names the phone, the code and how long", silent.includes("OnePlus LE2111") && silent.includes("0615-CF53") && silent.includes("1 h 35 min"));
check("silent: links to devices", silent.includes("https://x.dev/#/devices"));
check("recovered mentions the phone", recoveredMessage({ name: "OnePlus", code: "A-B" }).includes("OnePlus"));
check("problem: monitoring off says payments are NOT forwarded", problemMessage({ name: "P", code: "C", problem: "monitoring_off", dashboardUrl: "https://x.dev" }).includes("NOT being forwarded"));
check("problem: sms permission off", problemMessage({ name: "P", code: "C", problem: "sms_permission_off", dashboardUrl: "https://x.dev" }).includes("SMS permission"));

check("test message says alerts are working", testMessage().includes("Alerts are working"));
check("test message is plain text with no links", !/https?:\/\//.test(testMessage()));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
