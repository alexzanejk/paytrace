import { useState, type ReactNode } from "react";
import { Ellipsis, LogOut, Moon, ShieldCheck, Sun } from "lucide-react";
import { InstallButton } from "@/components/InstallCard";
import { GlobalSearchBox } from "@/components/GlobalSearchBox";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { cn } from "@/lib/utils";
import { sb } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { DeviceAlertBar } from "@/components/DeviceAlertBar";
import { deviceHealth } from "@/lib/deviceHealth";
import { useQuery } from "@/hooks/useQuery";
import { useNow } from "@/hooks/useNow";
import { useTheme } from "@/hooks/useTheme";
import type { SectionId, TabId } from "@/lib/nav";
import { BOTTOM_BAR, SECTIONS, pagesOf, sectionOf } from "@/lib/nav";
import { sectionBadges } from "@/lib/needsYou";

const WAITING = ["checking", "mismatch", "review"];

export function AppShell({
  tab,
  onTab,
  onSignOut,
  searching,
  children,
}: {
  tab: TabId;
  /** What the search box at the top is showing the answer for (null = an ordinary page is open). */
  searching: string | null;
  onTab: (t: TabId) => void;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const now = useNow(5000);
  const { dark, toggle } = useTheme();
  const section = sectionOf(tab);
  // The search answer belongs to no section: nothing is lit in the menu and no tabs show.
  const found = searching !== null;
  const pages = found ? [] : pagesOf(section);

  // Small live numbers for the menu: what waits for a person in each section, and how many phones are up.
  const { data: live } = useQuery(
    async () => {
      const count = (table: string, col: string, values: string[]) =>
        sb.from(table).select("id", { count: "exact", head: true }).in(col, values).then((r) => (r.error ? null : r.count ?? 0), () => null);
      const [held, sends, taka, payoutsUnsure, commissionUnsure, devices] = await Promise.all([
        count("payments", "status", ["review"]),
        count("job_transfers", "status", WAITING),
        count("cashin_jobs", "status", WAITING),
        count("payouts", "status", ["unsure"]),
        count("commission_pays", "status", ["unsure"]),
        sb.from("devices").select("id,last_seen_at,approved_at").eq("status", "approved"),
      ]);
      return { held, jobsWaiting: (sends ?? 0) + (taka ?? 0), payoutsUnsure, commissionUnsure, devices: devices.data ?? [] };
    },
    [],
    { refreshMs: 15000 },
  );
  const online = (live?.devices ?? []).filter((d) => deviceHealth(d, now).level === "online").length;
  const total = live?.devices.length ?? 0;
  const badges = live ? sectionBadges(live) : null;
  const sectionBadge = (id: SectionId): number => (badges && id in badges ? badges[id as keyof typeof badges] : 0);
  const pageBadge = (id: TabId): number =>
    !live ? 0 : id === "review" ? live.held ?? 0 : id === "jobs" ? live.jobsWaiting : id === "payout" ? live.payoutsUnsure ?? 0 : id === "commission" ? live.commissionUnsure ?? 0 : 0;

  const go = (id: TabId) => {
    onTab(id);
    setOpen(false);
  };
  const pill = (n: number) =>
    n > 0 ? <span className="rounded-full bg-status-warn-bg px-2 py-0.5 text-xs font-semibold text-status-warn">{n}</span> : null;

  const navButton = (s: (typeof SECTIONS)[number]) => {
    const on = !found && s.id === section.id;
    const Icon = s.icon;
    return (
      <button
        key={s.id}
        type="button"
        onClick={() => go(s.pages[0])}
        aria-current={on ? "page" : undefined}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors",
          on ? "bg-card text-primary shadow-[0_1px_3px_rgba(16,24,40,0.10)]" : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
        )}
      >
        <Icon className={cn("h-[18px] w-[18px] shrink-0", on ? "text-primary" : "")} aria-hidden />
        <span className="flex-1 text-left">{s.label}</span>
        {pill(sectionBadge(s.id))}
      </button>
    );
  };

  const extras = (
    <div className="flex flex-col gap-2 border-t border-border pt-4">
      <button type="button" onClick={() => go("devices")} className="flex items-center gap-2 rounded-lg px-4 py-2 text-left text-sm hover:bg-muted">
        <span
          aria-hidden
          className={cn("h-2.5 w-2.5 rounded-full", total === 0 ? "bg-muted-foreground" : online === total ? "bg-status-ok" : "bg-status-bad")}
        />
        <span>{total === 0 ? "No phones yet" : `${online} of ${total} phone${total === 1 ? "" : "s"} online`}</span>
      </button>
      <InstallButton onDone={() => setOpen(false)} />
      <Button variant="ghost" size="sm" onClick={toggle} className="justify-start" aria-pressed={dark}>
        {dark ? <Sun aria-hidden /> : <Moon aria-hidden />} {dark ? "Light mode" : "Dark mode"}
      </Button>
      <Button variant="ghost" size="sm" onClick={onSignOut} className="justify-start">
        <LogOut aria-hidden /> Sign out
      </Button>
    </div>
  );

  const menu = (
    <div className="flex h-full flex-col gap-5">
      <div className="flex flex-col gap-0.5">{SECTIONS.map(navButton)}</div>
      <div className="mt-auto">{extras}</div>
    </div>
  );

  // A section's pages as tabs across the top (nothing for a section with one page).
  const tabs =
    pages.length > 1 ? (
      <nav aria-label={`${section.label} pages`} className="-mx-4 mb-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
        <div className="flex w-max gap-1 rounded-xl border border-border bg-card p-1">
          {pages.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => go(p.id)}
              aria-current={tab === p.id ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                tab === p.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {p.label}
              {tab === p.id ? null : pill(pageBadge(p.id))}
            </button>
          ))}
        </div>
      </nav>
    ) : null;

  const inBar = SECTIONS.filter((s) => BOTTOM_BAR.includes(s.id));
  const moreOn = open || (!found && !BOTTOM_BAR.includes(section.id));
  const moreBadge = SECTIONS.filter((s) => !BOTTOM_BAR.includes(s.id)).reduce((n, s) => n + sectionBadge(s.id), 0);
  const barButton = (key: string, label: string, Icon: (typeof SECTIONS)[number]["icon"], on: boolean, n: number, onClick: () => void, extra?: Record<string, unknown>) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      aria-current={on ? "page" : undefined}
      {...extra}
      className={cn("relative flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-2 text-[11px] font-medium", on ? "text-primary" : "text-muted-foreground")}
    >
      <Icon className="h-5 w-5" aria-hidden />
      <span className="max-w-full truncate">{label}</span>
      {n > 0 ? (
        <span className="absolute right-[calc(50%-1.5rem)] top-1 min-w-4 rounded-full bg-status-warn px-1 text-center text-[10px] font-semibold leading-4 text-card" aria-label={`${n} waiting`}>
          {n}
        </span>
      ) : null}
    </button>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      {/* Wide screens: a fixed menu down the left. */}
      <aside className="sticky top-0 hidden h-dvh flex-col overflow-y-auto p-4 lg:flex">
        <h1 className="mb-6 flex items-center gap-2.5 px-3 pt-1 text-xl font-bold tracking-tight">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm" aria-hidden>
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
            <h1 className="flex shrink-0 items-center gap-2 text-lg font-semibold">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-primary-foreground" aria-hidden>
                <ShieldCheck className="h-4 w-4" />
              </span>
              PayTrace
            </h1>
            <GlobalSearchBox id="search-top" current={searching ?? ""} className="ml-auto flex-1 sm:max-w-sm" />
          </div>
        </header>
        <DeviceAlertBar onOpen={() => onTab("devices")} />
        {/* Phones and tablets: "More" shows the rest of the menu in place of the page. */}
        {open ? (
          <nav className="px-3 py-4 pb-24 lg:hidden" aria-label="More sections">
            <div className="flex flex-col gap-0.5">{SECTIONS.filter((s) => !BOTTOM_BAR.includes(s.id)).map(navButton)}</div>
            <div className="mt-4">{extras}</div>
          </nav>
        ) : null}
        <div className={cn("mx-auto max-w-[88rem] px-4 pb-24 pt-5 sm:pt-6 lg:px-8 lg:pb-6 lg:pl-4", open ? "hidden lg:block" : "")}>
          <GlobalSearchBox id="search-wide" current={searching ?? ""} className="mb-4 hidden max-w-md lg:block" />
          {tabs}
          <main key={found ? "search" : tab} className="page-in">
            {/* Inside the keyed <main>, so opening another page clears a failure. */}
            <ErrorBoundary>{children}</ErrorBoundary>
          </main>
        </div>
      </div>

      {/* Phones and tablets: the four sections used most, and More, always within thumb reach. */}
      <nav
        aria-label="Sections"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {inBar.map((s) => barButton(s.id, s.label, s.icon, !open && !found && s.id === section.id, sectionBadge(s.id), () => go(s.pages[0])))}
        {barButton("more", "More", Ellipsis, moreOn, moreBadge, () => setOpen((o) => !o), { "aria-expanded": open })}
      </nav>
    </div>
  );
}
