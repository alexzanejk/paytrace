import { useState, type ReactNode } from "react";
import { LogOut, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { TabId } from "@/lib/nav";
import { TABS } from "@/lib/nav";

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

  const navButton = (id: TabId, label: string, Icon: (typeof TABS)[number]["icon"], mobile = false) => (
    <button
      key={id}
      type="button"
      onClick={() => {
        onTab(id);
        setOpen(false);
      }}
      aria-current={tab === id ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
        mobile && "w-full justify-start",
        tab === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {label}
    </button>
  );

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-border bg-card">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <h1 className="text-lg font-semibold">PayTrace</h1>
          <nav className="ml-2 hidden flex-wrap gap-1 lg:flex" aria-label="Sections">
            {TABS.map((t) => navButton(t.id, t.label, t.icon))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onSignOut} className="hidden sm:inline-flex">
              <LogOut className="h-4 w-4" aria-hidden />
              Sign out
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>
        {open ? (
          <nav className="flex flex-col gap-1 border-t border-border px-4 py-3 lg:hidden" aria-label="Sections">
            {TABS.map((t) => navButton(t.id, t.label, t.icon, true))}
            <Button variant="ghost" size="sm" onClick={onSignOut} className="mt-1 justify-start sm:hidden">
              <LogOut className="h-4 w-4" aria-hidden />
              Sign out
            </Button>
          </nav>
        ) : null}
      </header>
      <main className="mx-auto max-w-7xl px-4 py-5">{children}</main>
    </div>
  );
}
