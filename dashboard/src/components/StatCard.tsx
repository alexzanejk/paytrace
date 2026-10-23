import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";

/** Cards sit two to a row on a phone and fill the width on a computer, and never squeeze a number onto two lines. */
export const STAT_GRID = "grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-3";

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: LucideIcon;
}) {
  return (
    <Card className="p-3.5 sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        {Icon ? <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
      </div>
      <p className="mt-1 whitespace-nowrap text-lg font-semibold tabular sm:text-xl 2xl:text-2xl">{value}</p>
      {sub ? <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{sub}</p> : null}
    </Card>
  );
}
