import { PROVIDER_COLOR } from "@/lib/deviceColors";
import { PROVIDER_LABEL } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ProviderChip({ provider, className }: { provider: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm", className)}>
      <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: PROVIDER_COLOR[provider] ?? "var(--color-muted-foreground)" }} />
      {PROVIDER_LABEL[provider] ?? provider}
    </span>
  );
}
