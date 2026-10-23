import { ClipboardList, Gauge, KeyRound, ListChecks, Receipt, ScrollText, Settings2, Smartphone } from "lucide-react";

export const TABS = [
  { id: "overview", label: "Overview", icon: Gauge, group: "Money" },
  { id: "payments", label: "Transactions", icon: Receipt, group: "Money" },
  { id: "review", label: "Review", icon: ListChecks, group: "Money" },
  { id: "orders", label: "Orders", icon: ClipboardList, group: "Money" },
  { id: "devices", label: "Phones", icon: Smartphone, group: "Manage" },
  { id: "api", label: "Websites", icon: KeyRound, group: "Manage" },
  { id: "logs", label: "Activity log", icon: ScrollText, group: "Manage" },
  { id: "settings", label: "Settings", icon: Settings2, group: "Manage" },
] as const;

export type TabId = (typeof TABS)[number]["id"];

export const isTabId = (v: string): v is TabId => TABS.some((t) => t.id === v);

export const GROUPS = ["Money", "Manage"] as const;
