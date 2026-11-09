import { appWayFor, wayToSend, wayWords, WAY_LABEL } from "../dashboard/src/lib/sendWay.ts";

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

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("\nall passed");
