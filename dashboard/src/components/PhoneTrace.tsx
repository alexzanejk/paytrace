import { reasonOf, traceOf } from "@/lib/phoneCommands";

/** The phone's own step log of a command ("What the phone saw"), folded away, with the phone's own reason for stopping
 *  shown above it in plain sight on a failure (owner 2026-11-19). It never contains a PIN. */
export function PhoneTrace({ screens, label, failed = true }: { screens: string[] | null | undefined; label?: string; failed?: boolean }) {
  const trace = traceOf(screens);
  if (!trace) return null;
  const reason = failed ? reasonOf(screens) : null;
  return (
    <div className="space-y-1">
      {reason ? <p className="text-xs"><span className="font-medium">Phone says why: </span>{reason}</p> : null}
      <details className="rounded-lg border bg-muted/40 px-3 py-2 text-xs">
        <summary className="cursor-pointer font-medium text-muted-foreground">{label ?? "What the phone saw (send this if it keeps failing)"}</summary>
        <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-4 text-muted-foreground">{trace}</pre>
      </details>
    </div>
  );
}
