import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The one confirmation for everything that moves or records money (owner 2026-11-14, step 5: Cash In, B2B, Payout
 *  and commission payout each had their own look). It stays on the page, under the numbers just typed, so they can
 *  be compared before pressing Yes. `children` says exactly what will happen; `note` is the one-line warning. */
export function MoneyConfirm({
  children, note, yes, busy, onYes, onBack,
}: {
  children: ReactNode;
  note?: string;
  /** The Yes button's words, e.g. "Yes, send it". */
  yes: string;
  busy?: boolean;
  onYes: () => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-status-warn bg-status-warn-bg p-3 text-sm" role="group" aria-label="Confirm">
      <p className="flex items-start gap-2 font-medium text-status-warn">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span className="min-w-0">{children}</span>
      </p>
      {note ? <p className="text-muted-foreground">{note}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={onYes}>{busy ? "Working…" : yes}</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onBack}>Back</Button>
      </div>
    </div>
  );
}
