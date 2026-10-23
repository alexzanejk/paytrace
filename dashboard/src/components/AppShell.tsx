import { useState, type ReactNode } from "react";
import { LogOut, Menu, ShieldCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { sb } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { DeviceAlertBar } from "@/components/DeviceAlertBar";
import { deviceHealth } from "@/lib/deviceHealth";
import { useQuery } from "@/hooks/useQuery";
import { useNow } from "@/hooks/useNow";
import type { TabId } from "@/lib/nav";
import { GROUPS, TABS } from "@/lib/nav";

export function AppShell({
  tab,
  onTab,
  onSignOut,
  children,
}: {
  tab: TabId;
  onTab: (t: TabId) => void;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const now = useNow(5000);

  // Small live numbers for the menu: how many payments wait for a person, and how many phones are up.
  const { data: live } = useQuery(
    async () => {
      const [review, devices] = await Promise.all([
        sb.from("payments").select("id", { count: "exact", head: true }).eq("status", "review").neq("txn_type", "cash_out"),
        sb.from("devices").select("id,last_seen_at,approved_at").eq("status", "approved"),
      ]);
      return { review: review.count ?? 0, devices: devices.data ?? [] };
    },
    [],
    { refreshMs: 15000 },
  );
  const online = (live?.devices ?? []).filter((d) => deviceHealth(d, now).level === "online").length;
  const total = live?.devices.length ?? 0;
  const badge = (id: TabId) => (id === "review" && live && live.review > 0 ? live.review : null);

  const navButton = (id: TabId, label: string, Icon: (typeof TABS)[number]["icon"]) => {
    const n = badge(id);
    return (
      <button
        key={id}
        type="button"
        onClick={() => {
          onTab(id);
          setOpen(false);
        }}
        aria-current={tab === id ? "page" : undefined}
        className={cn(
          "flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium transition-colors",
          tab === id ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-muted",
        )}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        <span className="flex-1 text-left">{label}</span>
        {n ? <span className="rounded-full bg-status-warn-bg px-2 py-0.5 text-xs font-semibold text-status-warn">{n}</span> : null}
      </button>
    );
  };

  const menu = (
    <div className="flex h-full flex-col gap-5">
      {GROUPS.map((g) => (
        <div key={g}>
          <p className="mb-1 px-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g}</p>
          <div className="flex flex-col gap-0.5">
            {TABS.filter((t) => t.group === g).map((t) => navButton(t.id, t.label, t.icon))}
          </div>
        </div>
      ))}
      <div className="mt-auto flex flex-col gap-2 border-t border-border pt-4">
        <button
          type="button"
          onClick={() => {
            onTab("devices");
            setOpen(false);
          }}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-left text-sm hover:bg-muted"
        >
          <span
            aria-hidden
            className={cn("h-2.5 w-2.5 rounded-full", total === 0 ? "bg-muted-foreground" : online === total ? "bg-status-ok" : "bg-status-bad")}
          />
          <span>
            {total === 0 ? "No phones yet" : `${online} of ${total} phone${total === 1 ? "" : "s"} online`}
          </span>
        </button>
        <Button variant="ghost" size="sm" onClick={onSignOut} className="justify-start">
          <LogOut aria-hidden /> Sign out
        </Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      {/* Wide screens: a fixed menu down the left. */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-border bg-card p-4 lg:flex">
        <h1 className="mb-6 flex items-center gap-2.5 px-4 pt-1 text-xl font-semibold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground" aria-hidden>
            <ShieldCheck className="h-4.5 w-4.5" />
          </span>
          PayTrace
        </h1>
        {menu}
      </aside>

      <div className="min-w-0">
        {/* Phones and tablets: a top bar with a menu button. */}
        <header className="sticky top-0 z-40 border-b border-border bg-card lg:hidden">
          <div className="flex items-center gap-3 px-4 py-3">
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-primary-foreground" aria-hidden>
                <ShieldCheck className="h-4 w-4" />
              </span>
              PayTrace
            </h1>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto"
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
          {open ? <nav className="border-t border-border px-3 py-3" aria-label="Sections">{menu}</nav> : null}
        </header>
        <DeviceAlertBar onOpen={() => onTab("devices")} />
        <main key={tab} className="page-in mx-auto max-w-6xl px-4 py-5 sm:py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
