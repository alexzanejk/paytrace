import { ClipboardList, Gauge, ListChecks, Receipt, ScrollText, Settings2, Smartphone } from "lucide-react";

export const TABS = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "review", label: "Review", icon: ListChecks },
  { id: "payments", label: "Payments", icon: Receipt },
  { id: "orders", label: "Orders", icon: ClipboardList },
  { id: "devices", label: "Devices", icon: Smartphone },
  { id: "logs", label: "Logs", icon: ScrollText },
  { id: "settings", label: "Settings", icon: Settings2 },
] as const;

export type TabId = (typeof TABS)[number]["id"];

export const isTabId = (v: string): v is TabId => TABS.some((t) => t.id === v);
