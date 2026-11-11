import { appBalanceFor, appWayFor, wayLabel, wayToSend, wayWords, WAY_LABEL } from "../dashboard/src/lib/sendWay.ts";

let failed = 0;
const check = (name: string, ok: boolean, got?: unknown) => {
  if (!ok) { failed++; console.error("FAIL", name, got ?? ""); } else console.log("ok  ", name);
};

const ready = { provider: "bkash", account: "agent", method: "cash_in", appCashin: true };
check("a bKash agent Cash In on a new build may go through the app", appWayFor(ready).ok);
check("Nagad and Rocket go by USSD", !appWayFor({ ...ready, provider: "nagad" }).ok && !appWayFor({ ...ready, provider: "rocket" }).ok);
check("a personal Send Money goes by USSD", !appWayFor({ ...ready, account: "personal" }).ok && !appWayFor({ ...ready, method: "send_money" }).ok);
check("an old app build is told to update", appWayFor({ ...ready, appCashin: undefined }).why.includes("Update"));
check("the app is sent only when allowed", wayToSend("app", ready) === "app" && wayToSend("app", { ...ready, appCashin: false }) === "ussd" && wayToSend("ussd", ready) === "ussd");
check("words name the way", wayWords("app").includes("bKash app") && wayWords("ussd").includes("*247#") && WAY_LABEL.app === "bKash app");
check("the balance can be read in the bKash app on a new build", appBalanceFor("bkash", true).ok);
check("only bKash is read in its app", !appBalanceFor("nagad", true).ok && !appBalanceFor("rocket", true).ok);
check("an old build cannot read the balance in the app", !appBalanceFor("bkash", undefined).ok && appBalanceFor("bkash", false).why.includes("Update"));

// ---- The Nagad agent app (migration 093) ----
check("a Nagad agent Cash In may go through the Nagad app on a build that says app_nagad", appWayFor({ ...ready, provider: "nagad", appCashin: undefined, appNagad: true }).ok);
check("not on an older build", appWayFor({ ...ready, provider: "nagad", appNagad: undefined }).why.includes("Nagad app way"));
check("a personal Nagad Send Money stays USSD", !appWayFor({ provider: "nagad", account: "personal", appNagad: true }).ok);
check("Rocket still has no app way", !appWayFor({ ...ready, provider: "rocket", appNagad: true }).ok);
check("the Nagad buttons are named for Nagad", wayLabel("app", "nagad") === "Nagad app" && wayLabel("ussd", "nagad") === "USSD (*167#)" && wayLabel("app", "bkash") === "bKash app");
check("the Nagad confirm words say হ্যাঁ, not tap and hold", wayWords("app", "nagad").includes("Nagad app") && !wayWords("app", "nagad").includes("tap and hold"));
check("the Nagad balance can be read in its app on a new build", appBalanceFor("nagad", undefined, true).ok && !appBalanceFor("nagad", true, undefined).ok);

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("\nall passed");
