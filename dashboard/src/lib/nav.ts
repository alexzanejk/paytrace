import { Bitcoin, HandCoins, BookOpen, BookText, Briefcase, ClipboardList, Hash, History, Home, KeyRound, ListChecks, Percent, Receipt, ScrollText, Settings2, Smartphone } from "lucide-react";

/** Every page. Ids are stable (the address bar, bookmarks and `lib/filters.ts` use them), so a link such as `#/numbers`
 *  keeps working whatever the menu looks like. `label` is the page's name on its tab. The money pages keep Admin Hub's
 *  own words (owner 2026-11-03): "Deposit orders", "Transactions", "Review". */
export const TABS = [
  { id: "overview", label: "Today", icon: Home },
  { id: "payments", label: "All transactions", icon: Receipt },
  { id: "orders", label: "Deposit orders", icon: ClipboardList },
  { id: "review", label: "Review", icon: ListChecks },
  { id: "ledger", label: "Wallet ledger", icon: BookText },
  { id: "payout", label: "Payout", icon: HandCoins },
  { id: "commission", label: "Commission", icon: Percent },
  { id: "jobs", label: "Set up", icon: Briefcase },
  { id: "jobhistory", label: "History", icon: History },
  { id: "devices", label: "Phones", icon: Smartphone },
  { id: "api", label: "Sites", icon: KeyRound },
  { id: "numbers", label: "Numbers by site", icon: Hash },
  { id: "crypto", label: "Crypto (USDT)", icon: Bitcoin },
  { id: "settings", label: "Settings", icon: Settings2 },
  { id: "logs", label: "Activity log", icon: ScrollText },
  { id: "help", label: "Help", icon: BookOpen },
] as const;

export type TabId = (typeof TABS)[number]["id"];

export const isTabId = (v: string): v is TabId => TABS.some((t) => t.id === v);

/** The menu (owner 2026-11-13: 16 items were too many, and pages that belong together were apart). Seven sections; a
 *  section with more than one page shows them as tabs across the top. The first page is where the section opens. */
export const SECTIONS = [
  { id: "home", label: "Home", icon: Home, pages: ["overview"] },
  { id: "transactions", label: "Transactions", icon: Receipt, pages: ["payments", "orders", "review", "ledger"] },
  { id: "payout", label: "Pay out", icon: HandCoins, pages: ["payout", "commission"] },
  { id: "jobs", label: "Jobs", icon: Briefcase, pages: ["jobs", "jobhistory"] },
  { id: "phones", label: "Phones", icon: Smartphone, pages: ["devices"] },
  { id: "websites", label: "Websites", icon: KeyRound, pages: ["api", "numbers", "crypto"] },
  { id: "settings", label: "Settings", icon: Settings2, pages: ["settings", "logs", "help"] },
] as const satisfies ReadonlyArray<{ id: string; label: string; icon: unknown; pages: readonly TabId[] }>;

export type Section = (typeof SECTIONS)[number];
export type SectionId = Section["id"];

/** The section a page lives in. */
export function sectionOf(tab: TabId): Section {
  return SECTIONS.find((s) => (s.pages as readonly TabId[]).includes(tab)) ?? SECTIONS[0];
}

/** A section's pages, in tab order. */
export function pagesOf(section: Section): Array<(typeof TABS)[number]> {
  return (section.pages as readonly TabId[]).map((id) => TABS.find((t) => t.id === id)!);
}

/** The four sections on a phone's bottom bar; the rest sit behind its "More" button. */
export const BOTTOM_BAR: readonly SectionId[] = ["home", "transactions", "payout", "phones"];

/** Opens a page from anywhere (the address bar drives the open page). */
export const openPage = (id: TabId) => { window.location.hash = `#/${id}`; };

/** Opens the Help page from anywhere. */
export const openHelp = () => openPage("help");
