import { traceOf } from "@/lib/phoneCommands";

/** The phone's own step log of a failed command ("What the phone saw"), folded away. It never contains a PIN. Shown so a
 *  failure can be understood from the dashboard instead of only from the phone's Settings card (owner 2026-11-04). */
export function PhoneTrace({ screens, label }: { screens: string[] | null | undefined; label?: string }) {
  const trace = traceOf(screens);
  if (!trace) return null;
  return (
    <details className="rounded-lg border bg-muted/40 px-3 py-2 text-xs">
      <summary className="cursor-pointer font-medium text-muted-foreground">{label ?? "What the phone saw (send this if it keeps failing)"}</summary>
      <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-4 text-muted-foreground">{trace}</pre>
    </details>
  );
}
