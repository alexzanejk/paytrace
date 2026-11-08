import { CheckCircle2, CircleAlert, CircleDashed } from "lucide-react";
import { tk } from "@/lib/format";
import {
  accountTitle, balanceLine, checkLine, dayBlocks, figures, sourceLine, stateLine,
  type CheckTone, type DayCheckRow, type DayMoneyRow,
} from "@/lib/dayMoney";
import { cn } from "@/lib/utils";

const WALLET: Record<string, string> = { bkash: "bKash", nagad: "Nagad", rocket: "Rocket", upay: "Upay" };

function Verdict({ text, tone }: { text: string; tone: CheckTone }) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "warn" ? CircleAlert : CircleDashed;
  return (
    <p className={cn("mt-2 flex gap-1 text-xs", tone === "ok" ? "text-status-ok" : tone === "warn" ? "text-status-warn" : "text-muted-foreground")}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {text}
    </p>
  );
}

/** One phone's day, 12:00 AM to 11:59 PM Bangladesh time, one block per wallet account: an agent's Cash Out and Cash In
 *  (and B2B), a personal account's Received and Sent. Each movement is counted ONCE, whether PayTrace saw it as an SMS, in
 *  the wallet's own statement, or as a cash-in it made itself (device_day_money). Under the figures, the day's balance and
 *  whether every change of it is accounted for (device_day_check, migration 069). */
export function DayMoney({
  rows, checks, error, checkError, dayLabel, today,
}: { rows: DayMoneyRow[]; checks: DayCheckRow[]; error: string; checkError: string; dayLabel: string; today: boolean }) {
  if (error) return <p className="text-xs text-status-warn">Could not load the day totals: {error}</p>;
  const blocks = dayBlocks(rows, checks);
  if (!blocks.length) return <p className="text-xs text-muted-foreground">Nothing moved through this phone's wallets on {dayLabel}.</p>;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Each wallet on {dayLabel} (12:00 AM to 11:59 PM Bangladesh time). Every movement is counted once, from the SMS or, when
        there was none, from the wallet's own statement.
      </p>
      {checkError ? <p className="text-xs text-status-warn">Could not check the balances: {checkError}</p> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {blocks.map((b) => {
          const title = b.money ? accountTitle(b.money) : `${WALLET[b.provider] ?? b.provider} ${b.account}${b.check?.sim_slot != null ? ` · SIM ${b.check.sim_slot + 1}` : ""}`;
          const verdict = b.money && (!b.money.checked || b.money.account === "unknown") ? checkLine(b.money) : b.check ? stateLine(b.check) : b.money ? checkLine(b.money) : null;
          return (
            <div key={b.key} className="rounded-lg border border-border p-3">
              <p className="mb-2 text-sm font-medium">{title}</p>
              {b.money ? (
                <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
                  {figures(b.money).map((f) => (
                    <div key={f.label} className="contents">
                      <dt className="text-muted-foreground">{f.label}</dt>
                      <dd className="text-right tabular">
                        <span className="font-semibold">{tk(f.amount)}</span>
                        <span className="ml-1 text-xs text-muted-foreground">{f.n}×</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">Nothing moved.</p>
              )}
              {b.check ? <p className="mt-2 text-xs tabular">{balanceLine(b.check, today)}</p> : null}
              {verdict ? <Verdict text={verdict.text} tone={verdict.tone} /> : null}
              {b.money ? <p className="mt-1 text-xs text-muted-foreground">{sourceLine(b.money)}</p> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
