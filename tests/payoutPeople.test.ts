import { NO_NAME, WIDE_LIMIT, capLine, groupByPerson, groupLine, peopleFrom, personKey, personOption, rowsOfPerson } from "../dashboard/src/lib/payoutPeople.ts";
import { namesById, type PaymentName } from "../dashboard/src/lib/payNames.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

const named: PaymentName[] = [
  { payment_id: "a1", name: "@alice", source: "telegram", tg_user_id: 1 },
  { payment_id: "a2", name: "@Alice", source: "owner", tg_user_id: 1 },
  { payment_id: "a3", name: "@alice", source: "telegram", tg_user_id: 1 },
  { payment_id: "b1", name: "@bob", source: "telegram", tg_user_id: 2 },
  { payment_id: "b2", name: "@bob", source: "telegram", tg_user_id: 2 },
  { payment_id: "c1", name: "rifat vai", source: "owner" },
  { payment_id: "d1", name: "Rifat Vai ", source: "owner" },
  { payment_id: "x1", name: null, source: "telegram" },
];

check("a person is the Telegram id when known, else the lower-cased name; nothing without a name",
  personKey(named[0]) === "u:1" && personKey(named[1]) === "u:1" && personKey(named[5]) === "n:rifat vai" && personKey(named[6]) === "n:rifat vai"
  && personKey(named[7]) === null && personKey(undefined) === null);

const people = peopleFrom(named, 10);
check("people are ordered most transactions first, ties by name, and No name last with the rest of the total",
  people.map((p) => `${p.label}:${p.count}`).join(",") === "@alice:3,@bob:2,rifat vai:2,No name:3", people);
check("the no-name count never goes below zero", peopleFrom(named, 2).at(-1)!.count === 0 && peopleFrom([], 0).length === 1 && peopleFrom([], 0)[0].key === NO_NAME);
check("the dropdown wording", personOption(people[0]) === "@alice · 3" && personOption(people.at(-1)!) === "No name · 3");

const names = namesById(named);
const rows = [
  { id: "x1", amount: 100 }, { id: "b1", amount: "200" }, { id: "a1", amount: 500 }, { id: "zz", amount: 50 },
  { id: "c1", amount: 10 }, { id: "a2", amount: 500 }, { id: "d1", amount: 20 }, { id: "b2", amount: 300 }, { id: "a3", amount: 1000 },
];
const groups = groupByPerson(rows, names);
check("groups: most rows first, rows keep their order inside, totals summed, No name last",
  groups.map((g) => `${g.label}:${g.rows.map((r) => r.id).join("+")}:${g.total}`).join(" | ")
    === "@alice:a1+a2+a3:2000 | @bob:b1+b2:500 | rifat vai:c1+d1:30 | No name:x1+zz:150", groups);
check("a group's header line", groupLine(groups[0], (n) => `Tk ${n}`) === "@alice · 3 transactions · Tk 2000" && groupLine({ key: "k", label: "@x", rows: [1], total: 5 }, (n) => `Tk ${n}`) === "@x · 1 transaction · Tk 5");
check("no rows = no groups", groupByPerson([], names).length === 0);
check("the rows of one person, and of nobody",
  rowsOfPerson(rows, names, "u:2").map((r) => r.id).join(",") === "b1,b2" && rowsOfPerson(rows, names, NO_NAME).map((r) => r.id).join(",") === "x1,zz" && rowsOfPerson(rows, names, "u:9").length === 0);
check("the cap line only past the wide limit", capLine(WIDE_LIMIT) === "" && capLine(1200) === "Showing the newest 1,000 of 1,200: shorten the period to see everyone." && capLine(5, 3).includes("newest 3 of 5"));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
