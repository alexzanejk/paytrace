import type { ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";

/** A section that stays folded until it is needed, with a one-line summary so the important figure is visible without opening it. */
export function Disclosure({
  icon: Icon,
  title,
  summary,
  children,
}: {
  icon: LucideIcon;
  title: string;
  summary?: ReactNode;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-lg border border-border">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg p-3 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        <span className="text-sm font-semibold">{title}</span>
        {summary ? <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground">{summary}</span> : <span className="ml-auto" />}
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-border p-3">{children}</div>
    </details>
  );
}
