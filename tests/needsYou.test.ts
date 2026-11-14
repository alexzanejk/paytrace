import { needs, unchecked, nameList, sectionBadges, type NeedCounts } from "../dashboard/src/lib/needsYou.ts";
import { BOTTOM_BAR, SECTIONS, TABS, isTabId, pagesOf, sectionOf } from "../dashboard/src/lib/nav.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

const quiet: NeedCounts = {
  held: 0, jobsWaiting: 0, payoutsUnsure: 0, commissionUnsure: 0, commissionDue: { partners: 0, amount: 0 },
  phonesOffline: [], phonesOutdated: [], numbersMissing: [], numbersInvalid: 0, webhooksFailed: 0, cryptoReview: 0,
};

// ---- the "Needs you" list ----
check("a quiet day lists nothing", needs(quiet).length === 0 && unchecked(quiet).length === 0);
{
  const list = needs({ ...quiet, held: 3, jobsWaiting: 1, phonesOffline: ["Vivo"], commissionDue: { partners: 2, amount: 2794.72 } });
  check("worst first: an offline phone comes before decisions", list[0].id === "offline" && list.map((n) => n.id).join() === "offline,held,jobs,commission", list.map((n) => n.id));
  check("counts are in the words", list[1].title === "3 payments held for review" && list[2].title === "1 job waiting for your OK");
  check("commission shows the money and the partners", list[3].title === "Tk 2,794.72 commission due" && list[3].detail.startsWith("To 2 partners"));
  check("one offline phone reads in the singular", list[0].title === "1 phone offline" && list[0].detail.includes("its numbers") && list[0].detail.includes("it is back"));
}
{
  const list = needs({ ...quiet, payoutsUnsure: 1, commissionUnsure: 2 });
  check("unsure payouts and commission payments are one line", list.length === 1 && list[0].title.startsWith("3 payments") && list[0].page === "payout");
  check("only commission unsure opens Commission", needs({ ...quiet, commissionUnsure: 1 })[0].page === "commission");
}
{
  const list = needs({ ...quiet, numbersMissing: ["bkash", "rocket"], numbersInvalid: 1 });
  check("deposit numbers: missing wallets named, invalid counted", list.length === 1 && list[0].detail === "No bKash and Rocket number for customers to pay to; 1 number that cannot be a real number.", list[0]?.detail);
}
check("failed website results, USDT and old apps each get a line",
  needs({ ...quiet, webhooksFailed: 2, cryptoReview: 1, phonesOutdated: ["rubel", "OnePlus", "Redmi"] }).map((n) => n.id).join() === "webhooks,crypto,outdated");
check("three names are shortened", nameList(["a", "b", "c", "d"]) === "a, b and 2 more" && nameList(["a", "b"]) === "a and b" && nameList(["a"]) === "a");
{
  const c: NeedCounts = { ...quiet, held: null, numbersMissing: null, numbersInvalid: null, commissionDue: null };
  check("an unknown count is never a line", needs(c).length === 0);
  check("and it is said, each name once", unchecked(c).join() === "held payments,commission due,deposit numbers", unchecked(c));
}
check("menu badges", (() => { const b = sectionBadges({ held: 4, jobsWaiting: null, payoutsUnsure: 1, commissionUnsure: 1 }); return b.transactions === 4 && b.jobs === 0 && b.payout === 2; })());
check("every line opens a real page", needs({ ...quiet, held: 1, jobsWaiting: 1, payoutsUnsure: 1, commissionDue: { partners: 1, amount: 5 }, phonesOffline: ["a"], phonesOutdated: ["a"], numbersInvalid: 1, webhooksFailed: 1, cryptoReview: 1 }).every((n) => isTabId(n.page)));

// ---- the menu: seven sections, every page in exactly one ----
check("seven sections", SECTIONS.length === 7);
{
  const all = SECTIONS.flatMap((s) => [...s.pages]);
  check("every page is in exactly one section", all.length === TABS.length && new Set(all).size === TABS.length && TABS.every((t) => all.includes(t.id)), all);
}
check("the old page addresses still exist", ["overview", "orders", "payments", "review", "payout", "ledger", "commission", "crypto", "devices", "jobs", "jobhistory", "api", "numbers", "logs", "settings", "help"].every(isTabId));
check("a page knows its section", sectionOf("review").id === "transactions" && sectionOf("numbers").id === "websites" && sectionOf("jobhistory").id === "jobs" && sectionOf("help").id === "settings");
check("tabs come in the section's order", pagesOf(sectionOf("orders")).map((p) => p.label).join() === "All transactions,Deposit orders,Review,Wallet ledger");
check("the bottom bar holds four real sections", BOTTOM_BAR.length === 4 && BOTTOM_BAR.every((id) => SECTIONS.some((s) => s.id === id)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
