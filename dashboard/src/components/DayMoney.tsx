import { CheckCircle2, CircleAlert, CircleDashed } from "lucide-react";
import { tk } from "@/lib/format";
import { accountTitle, checkLine, figures, sourceLine, type DayMoneyRow } from "@/lib/dayMoney";
import { cn } from "@/lib/utils";

/** One phone's day, 12:00 AM to 11:59 PM Bangladesh time (owner 2026-11-08), one block per account: an agent's Cash Out
 *  and Cash In (and B2B), a personal account's Received and Sent. Each movement is counted once, whether it was seen as
 *  an SMS, in the wallet's statement or as a cash-in PayTrace made itself (device_day_money). The last line says whether
 *  every balance change of the day is accounted for. */
export function DayMoney({ rows, error, dayLabel }: { rows: DayMoneyRow[]; error: string; dayLabel: string }) {
  if (error) return <p className="text-xs text-status-warn">Could not load the day totals: {error}</p>;
  if (!rows.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Each account on {dayLabel}, every movement counted once:</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {rows.map((r) => {
          const c = checkLine(r);
          const Icon = c.tone === "ok" ? CheckCircle2 : c.tone === "warn" ? CircleAlert : CircleDashed;
          return (
            <div key={`${r.provider}:${r.account}:${r.sim_slot ?? "x"}`} className="rounded-lg border border-border p-3">
              <p className="mb-2 text-sm font-medium">{accountTitle(r)}</p>
              <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
                {figures(r).map((f) => (
                  <div key={f.label} className="contents">
                    <dt className="text-muted-foreground">{f.label}</dt>
                    <dd className="text-right tabular">
                      <span className="font-semibold">{tk(f.amount)}</span>
                      <span className="ml-1 text-xs text-muted-foreground">{f.n}×</span>
                    </dd>
                  </div>
                ))}
              </dl>
              <p className={cn("mt-2 flex gap-1 text-xs", c.tone === "ok" ? "text-status-ok" : c.tone === "warn" ? "text-status-warn" : "text-muted-foreground")}>
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {c.text}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{sourceLine(r)}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
