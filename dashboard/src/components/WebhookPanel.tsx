import { useState } from "react";
import { sb } from "@/lib/supabase";
import { when } from "@/lib/format";
import { answerText, eventLabel, orderRef, outboxState, siteNeedsAttention, summarizeSite, summaryLine, type OutboxRow } from "@/lib/webhooks";
import { Button } from "@/components/ui/button";

/** The result messages sent to one website in the last 7 days: how many got through, which did not, and Retry. */
export function WebhookPanel({ siteId, rows, onChanged }: { siteId: string; rows: OutboxRow[]; onChanged: () => void }) {
  const s = summarizeSite(rows, siteId);
  const [busy, setBusy] = useState<number | "all" | null>(null);
  const [note, setNote] = useState("");

  async function retryOne(id: number) {
    setBusy(id);
    setNote("");
    const { error } = await sb.rpc("retry_webhook", { p_id: id });
    setBusy(null);
    setNote(error ? error.message : "Queued. PayTrace tries again within a minute.");
    onChanged();
  }
  async function retryAll() {
    setBusy("all");
    setNote("");
    const { data, error } = await sb.rpc("retry_site_webhooks", { p_key: siteId });
    setBusy(null);
    setNote(error ? error.message : `Queued ${Number(data) || 0} message${Number(data) === 1 ? "" : "s"}. PayTrace tries again within a minute.`);
    onChanged();
  }

  const line = summaryLine(s);
  if (!line) return <p className="text-xs text-muted-foreground">No result messages were sent to this site in the last 7 days.</p>;
  const attention = siteNeedsAttention(s);
  const shown = s.problems.slice(0, 8);
  return (
    <div className={`grid gap-2 rounded-lg border p-3 ${attention ? "border-status-warn/60 bg-status-warn/5" : "border-border"}`} data-testid="webhook-panel">
      <p className="text-sm">{line}</p>
      {attention ? (
        <p className="text-xs text-muted-foreground">
          The site's server answered with an error, so it has not been told these orders' results. Show the answer below to its developer; press Retry once the address is fixed.
        </p>
      ) : null}
      {shown.length ? (
        <ul className="grid gap-1.5">
          {shown.map((r) => {
            const st = outboxState(r);
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="min-w-0">
                  <span className="font-medium">{eventLabel(r.event)}</span> · order <span className="font-mono">{orderRef(r)}</span> · {r.attempts} {r.attempts === 1 ? "try" : "tries"} · {answerText(r.last_status)}
                  {st === "gave_up" && r.gave_up_at ? <span className="text-status-bad"> · PayTrace gave up {when(r.gave_up_at)}</span> : null}
                  {st === "retrying" && r.next_attempt_at ? <span className="text-muted-foreground"> · next try {when(r.next_attempt_at)}</span> : null}
                  {st === "waiting" ? <span className="text-muted-foreground"> · sending</span> : null}
                </span>
                <Button size="sm" variant="outline" onClick={() => void retryOne(r.id)} disabled={busy !== null} aria-label={`Retry the ${eventLabel(r.event)} message for order ${orderRef(r)}`}>
                  {busy === r.id ? "Queuing…" : "Retry"}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {s.problems.length > shown.length ? <p className="text-xs text-muted-foreground">and {s.problems.length - shown.length} more</p> : null}
      {s.problems.length > 1 ? (
        <div>
          <Button size="sm" onClick={() => void retryAll()} disabled={busy !== null}>{busy === "all" ? "Queuing…" : `Retry all ${s.problems.length}`}</Button>
        </div>
      ) : null}
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}
