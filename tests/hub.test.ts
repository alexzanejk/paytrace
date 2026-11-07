import { actorOf, extractHubKey, isUuid, routeOf } from "../supabase/functions/hub/logic.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

const good = "pth_" + "a".repeat(64);
check("a Hub key is accepted", extractHubKey(`Bearer ${good}`) === good);
check("a website key is refused at this door", extractHubKey(`Bearer ptk_${"a".repeat(64)}`) === null);
check("a short or missing key is refused", extractHubKey("Bearer pth_abc") === null && extractHubKey(null) === null && extractHubKey("") === null);
check("the scheme must be Bearer", extractHubKey(good) === null);

check("routes: held by GET or POST", routeOf("/functions/v1/hub/held", "GET") === "held" && routeOf("/hub/held/", "POST") === "held");
check("routes: credit and ignore are POST only", routeOf("/hub/credit", "POST") === "credit" && routeOf("/hub/credit", "GET") === null && routeOf("/hub/ignore", "POST") === "ignore");
check("an unknown route is refused", routeOf("/hub/delete", "POST") === null && routeOf("/hub", "GET") === null);

check("uuid check", isUuid("5867547f-c485-44f9-bd94-dfe7a83a3748") && !isUuid("5867547f") && !isUuid(5));
check("the actor is cleaned and capped", actorOf("  owner@example.com\n ") === "owner@example.com" && actorOf("x".repeat(300)).length === 100 && actorOf(undefined) === "");

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
