import { useEffect, useState } from "react";
import { Download, History } from "lucide-react";
import { sb } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { historyCsv, historyLine, historySummary, type HistoryEvent } from "@/lib/tgHistory";
import { dhakaTime } from "@/lib/dayMoney";

/** One person's timeline (step 5, owner 2026-11-20): posts, matches, replies, queued payouts, payouts paid. Read on
 *  demand from `tg_person_history`; never guesses: a refused read is shown as such. */
export function PersonHistory({ userId, label, days = 30, onClose }: { userId: number; label: string; days?: number; onClose: () => void }) {
  const [events, setEvents] = useState<HistoryEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const from = new Date(Date.now() - days * 86400e3).toISOString();
    sb.rpc("tg_person_history", { p_user: userId, p_from: from }).then(({ data, error }) => {
      if (!live) return;
      if (error) setError(error.message); else setEvents((data as HistoryEvent[] | null) ?? []);
    });
    return () => { live = false; };
  }, [userId, days]);
  const download = () => {
    if (!events) return;
    const blob = new Blob([historyCsv(events)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `telegram-${userId}-history.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="mt-3 rounded-lg border border-border p-3 text-sm" aria-label={`History of ${label}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold"><History className="mr-1 inline h-4 w-4" aria-hidden /> History of {label} <span className="font-normal text-muted-foreground">(last {days} days)</span></h4>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={download} disabled={!events?.length}><Download className="mr-1 h-3.5 w-3.5" aria-hidden /> CSV</Button>
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>
      {error ? <p className="mt-2 text-status-bad">Could not read the history: {error}</p> : null}
      {events && !error ? <p className="mt-1 text-xs text-muted-foreground">{historySummary(events)}</p> : null}
      {events === null && !error ? <p className="mt-2 text-muted-foreground">Loading…</p> : null}
      {events && events.length === 0 ? <p className="mt-2 text-muted-foreground">Nothing in these {days} days.</p> : null}
      {events && events.length > 0 ? (
        <ol className="mt-2 divide-y divide-border">
          {events.map((e, i) => {
            const l = historyLine(e);
            return (
              <li key={(e.id ?? "") + e.kind + i} className="flex flex-wrap items-start gap-2 py-1.5">
                <span className="w-36 shrink-0 text-xs text-muted-foreground">{e.at ? dhakaTime(e.at) : ""}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><Badge tone={l.tone}>{e.kind === "post" ? "Post" : e.kind.startsWith("plan_") ? "Queue" : e.kind === "payout" ? "Payout" : "Reply"}</Badge><span>{l.title}</span></div>
                  {l.detail ? <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{l.detail}</p> : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}
