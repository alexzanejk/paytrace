import type { ReactNode } from "react";
import { Loader2, TriangleAlert } from "lucide-react";

/** Every page shows loading and failure the same way. */
export function Screen({
  loading,
  error,
  hasData,
  children,
}: {
  loading: boolean;
  error: string | null;
  hasData: boolean;
  children: ReactNode;
}) {
  if (error && !hasData) {
    return (
      <div className="flex items-start gap-2 rounded-card border border-border bg-card p-4 text-destructive">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p className="text-sm">Could not load: {error}</p>
      </div>
    );
  }
  if (loading && !hasData) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        <span className="text-sm">Loading…</span>
      </div>
    );
  }
  return <>{children}</>;
}
