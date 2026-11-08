import { Bitcoin, HandCoins, BookOpen, BookText, Briefcase, ClipboardList, Gauge, Hash, KeyRound, ListChecks, Percent, Receipt, ScrollText, Settings2, Smartphone } from "lucide-react";

/** The menu. Ids are stable (bookmarks and `lib/filters.ts` use them). The labels are Admin Hub's own words (owner
 *  2026-11-03: PayTrace is Admin Hub's payment automation, so the two must say the same thing): Admin Hub has a
 *  "Transactions Stream", "Deposit orders", and sends people to "the Review page in PayTrace". Money pages sit in the
 *  order money moves: expected (Deposit orders) -> arrived (Transactions) -> did not match (Review). */
export const TABS = [
  { id: "overview", label: "Overview", icon: Gauge, group: "Money" },
  { id: "orders", label: "Deposit orders", icon: ClipboardList, group: "Money" },
  { id: "payments", label: "Transactions", icon: Receipt, group: "Money" },
  { id: "review", label: "Review", icon: ListChecks, group: "Money" },
  { id: "payout", label: "Payout", icon: HandCoins, group: "Money" },
  { id: "ledger", label: "Wallet ledger", icon: BookText, group: "Money" },
  { id: "commission", label: "Commission", icon: Percent, group: "Money" },
  { id: "crypto", label: "Crypto (USDT)", icon: Bitcoin, group: "Money" },
  { id: "devices", label: "Phones", icon: Smartphone, group: "Manage" },
  { id: "jobs", label: "Jobs", icon: Briefcase, group: "Manage" },
  { id: "api", label: "Websites", icon: KeyRound, group: "Manage" },
  { id: "numbers", label: "Numbers by site", icon: Hash, group: "Manage" },
  { id: "logs", label: "Activity log", icon: ScrollText, group: "Manage" },
  { id: "settings", label: "Settings", icon: Settings2, group: "Manage" },
  { id: "help", label: "Help", icon: BookOpen, group: "Manage" },
] as const;

export type TabId = (typeof TABS)[number]["id"];

export const isTabId = (v: string): v is TabId => TABS.some((t) => t.id === v);

export const GROUPS = ["Money", "Manage"] as const;

/** Opens the Help page from anywhere (the address bar drives the open section). */
export const openHelp = () => { window.location.hash = "#/help"; };
