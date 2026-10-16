import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";

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
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        {Icon ? <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
      </div>
      <p className="mt-1 text-2xl font-semibold tabular">{value}</p>
      {sub ? <p className="mt-1 text-sm text-muted-foreground">{sub}</p> : null}
    </Card>
  );
}
