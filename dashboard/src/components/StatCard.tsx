import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Cards sit two to a row on a phone and fill the width on a computer, and never squeeze a number onto two lines. */
export const STAT_GRID = "grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-3";

export type Tone = "plain" | "blue" | "green" | "purple" | "amber" | "rose";

const TONE: Record<Exclude<Tone, "plain">, string> = {
  blue: "bg-tile-blue",
  green: "bg-tile-green",
  purple: "bg-tile-purple",
  amber: "bg-tile-amber",
  rose: "bg-tile-rose",
};

/** A figure with its label. A coloured [tone] makes it a bright tile (white text); "plain" is a white card. */
export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "plain",
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: LucideIcon;
  tone?: Tone;
}) {
  const coloured = tone !== "plain";
  return (
    <Card className={cn("p-3.5 sm:p-4", coloured && cn(TONE[tone as Exclude<Tone, "plain">], "border-transparent text-white shadow-sm"))}>
      <div className="flex items-start justify-between gap-2">
        <p className={cn("text-sm", coloured ? "text-white/85" : "text-muted-foreground")}>{label}</p>
        {Icon ? (
          <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full", coloured ? "bg-white/20" : "bg-muted")}>
            <Icon className={cn("h-4 w-4", coloured ? "text-white" : "text-muted-foreground")} aria-hidden />
          </span>
        ) : null}
      </div>
      <p className="mt-1 whitespace-nowrap text-lg font-semibold tabular sm:text-xl 2xl:text-2xl">{value}</p>
      {sub ? <p className={cn("mt-1 text-xs sm:text-sm", coloured ? "text-white/85" : "text-muted-foreground")}>{sub}</p> : null}
    </Card>
  );
}
