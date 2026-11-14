import { PHONE_TABS, phoneHash, phoneProblems, phoneTabOf, problemLine, tabCounts, type PhoneFacts } from "../dashboard/src/lib/phoneList.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

const fine: PhoneFacts = { online: true, lastHeard: "just now", blocking: [], otherProblems: 0, buildsBehind: 0, openGaps: 0 };

check("five tabs, Today first", PHONE_TABS.map((t) => t.label).join() === "Today,Wallets,Send money,Commission,Tools");
check("an unknown or missing tab opens Today", phoneTabOf(undefined) === "today" && phoneTabOf("nonsense") === "today" && phoneTabOf("send") === "send");
check("a phone's address", phoneHash("abc") === "#/devices/abc/today" && phoneHash("abc", "tools") === "#/devices/abc/tools");

check("a healthy phone has nothing wrong", phoneProblems(fine).length === 0 && problemLine(phoneProblems(fine)) === "");
{
  const list = phoneProblems({ ...fine, online: false, lastHeard: "40 min ago", openGaps: 2, buildsBehind: 12, otherProblems: 1 });
  check("worst first: offline before the rest", list[0].text === "Offline, last heard 40 min ago" && list[0].tone === "bad", list);
  check("the list line names the worst and counts the rest", problemLine(list) === "Offline, last heard 40 min ago · +3 more", problemLine(list));
  check("each problem points at the tab that deals with it", list.map((p) => p.tab).join() === "tools,wallets,tools,tools");
  const c = tabCounts(list);
  check("tab counts", c.tools === 3 && c.wallets === 1 && c.today === 0 && c.send === 0 && c.commission === 0, c);
}
{
  const list = phoneProblems({ ...fine, blocking: ["SMS permission is off, so it cannot see payment messages"] });
  check("a blocking problem is red and capitalised", list.length === 1 && list[0].tone === "bad" && list[0].text.startsWith("SMS permission"));
}
check("singular words", phoneProblems({ ...fine, openGaps: 1 })[0].text === "1 balance change to explain" && phoneProblems({ ...fine, buildsBehind: 1 })[0].text === "Old app (1 build behind)");
check("an unknown app version is not a problem", phoneProblems({ ...fine, buildsBehind: null }).length === 0);
check("one problem has no '+more'", problemLine(phoneProblems({ ...fine, otherProblems: 2 })) === "2 settings to fix on the phone");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
