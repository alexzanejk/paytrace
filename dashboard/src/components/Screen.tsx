import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";

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
      <div role="status" aria-label="Loading" className="animate-pulse space-y-5 motion-reduce:animate-none">
        <div className="space-y-2">
          <div className="h-6 w-40 rounded-md bg-muted" />
          <div className="h-4 w-72 max-w-full rounded-md bg-muted" />
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-card border border-border bg-card" />
          ))}
        </div>
        <div className="h-56 rounded-card border border-border bg-card" />
        <span className="sr-only">Loading…</span>
      </div>
    );
  }
  return <>{children}</>;
}
