// The Phones page as a short list (owner 2026-11-13, step 3 of the dashboard plan): one line per phone, and each phone
// opens its own page with five tabs. Pure words and choices; no I/O and no imports, so it runs in the node tests.

/** One phone's own page. Everything that used to sit on the phone's long card lives under one of these. */
export const PHONE_TABS = [
  { id: "today", label: "Today" },
  { id: "wallets", label: "Wallets" },
  { id: "send", label: "Send money" },
  { id: "commission", label: "Commission" },
  { id: "tools", label: "Tools" },
] as const;

export type PhoneTabId = (typeof PHONE_TABS)[number]["id"];

/** The tab named in the address bar, or Today. */
export function phoneTabOf(segment: string | undefined): PhoneTabId {
  return PHONE_TABS.some((t) => t.id === segment) ? (segment as PhoneTabId) : "today";
}

/** The address of a phone's page (the browser's Back button then returns to the list). */
export const phoneHash = (deviceId: string, tab: PhoneTabId = "today") => `#/devices/${deviceId}/${tab}`;

export interface PhoneFacts {
  online: boolean;
  /** "12 min ago", from the last check-in. */
  lastHeard: string;
  /** Things that stop payments being captured right now (SMS permission off, monitoring off). */
  blocking: string[];
  /** Other things the phone reports that are worth fixing. */
  otherProblems: number;
  /** How many builds behind the newest app this phone is; 0 or null when it is up to date or unknown. */
  buildsBehind: number | null;
  /** Balance changes on this phone's wallets that no SMS or statement explains yet. */
  openGaps: number;
}

export interface PhoneProblem {
  /** "bad" = payments may be missed right now; "warn" = worth fixing. */
  tone: "bad" | "warn";
  text: string;
  /** The tab of the phone's page that deals with it. */
  tab: PhoneTabId;
}

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** What is wrong with a phone, worst first. Empty when all is well. */
export function phoneProblems(f: PhoneFacts): PhoneProblem[] {
  const out: PhoneProblem[] = [];
  if (!f.online) out.push({ tone: "bad", text: `Offline, last heard ${f.lastHeard}`, tab: "tools" });
  for (const b of f.blocking) out.push({ tone: "bad", text: b.replace(/^./, (c) => c.toUpperCase()), tab: "tools" });
  if (f.openGaps > 0) out.push({ tone: "warn", text: `${plural(f.openGaps, "balance change")} to explain`, tab: "wallets" });
  if (f.buildsBehind && f.buildsBehind > 0) out.push({ tone: "warn", text: `Old app (${plural(f.buildsBehind, "build")} behind)`, tab: "tools" });
  if (f.otherProblems > 0) out.push({ tone: "warn", text: `${plural(f.otherProblems, "setting")} to fix on the phone`, tab: "tools" });
  return out;
}

/** The one line shown in the list: the worst problem, and how many more there are. */
export function problemLine(list: PhoneProblem[]): string {
  if (!list.length) return "";
  return list.length === 1 ? list[0].text : `${list[0].text} · +${list.length - 1} more`;
}

/** How many problems each tab should show beside its name. */
export function tabCounts(list: PhoneProblem[]): Record<PhoneTabId, number> {
  const counts: Record<PhoneTabId, number> = { today: 0, wallets: 0, send: 0, commission: 0, tools: 0 };
  for (const p of list) counts[p.tab] += 1;
  return counts;
}
