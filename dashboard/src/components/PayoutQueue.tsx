import { useState } from "react";
import { must, sb } from "@/lib/supabase";
import { useQuery } from "@/hooks/useQuery";
import { dhakaTime } from "@/lib/dayMoney";
import { PLAN_WORDS, planLine, queuePositions, recentPlans, type PayoutPlan } from "@/lib/payoutPlans";
import { openPage } from "@/lib/nav";
import { Confirm } from "@/components/Confirm";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** The payouts queued per person (step 4): what waits, what the phones are sending, what ended today. A waiting one can
 *  be taken back; one that started is an ordinary payout and is decided on the Payout page. */
export function PayoutQueue({ nameOf, refreshKey }: { nameOf: (id: string | null | undefined) => string; refreshKey?: unknown }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const { data, error, refresh } = useQuery(
    async () => {
      const since = new Date(Date.now() - 2 * 86_400_000).toISOString();
      const rows = must(await sb.from("payout_plans").select("*").or(`status.in.(queued,sending,unsure),created_at.gte.${since}`).order("created_at", { ascending: false }).limit(200)) as PayoutPlan[];
      return recentPlans(rows);
    },
    [refreshKey],
    { refreshMs: 10000 },
  );
  const plans = data ?? [];
  const pos = queuePositions(plans);
  if (error) return <Card className="mt-6 p-4 text-sm text-status-bad">Could not read the payout queue: {error}</Card>;
  if (plans.length === 0) return null;

  async function cancel(id: string) {
    setBusy(id); setProblem("");
    const { error } = await sb.rpc("cancel_payout_plan", { p_plan: id });
    setBusy(null);
    if (error) setProblem(error.message);
    refresh();
  }

  return (
    <Card className="mt-6 p-4">
      <h3 className="font-semibold">Payouts queued from here</h3>
      <p className="mb-3 text-sm text-muted-foreground">One per person. A phone sends one at a time; the rest wait their turn. Once a payout has started it shows on the Payout page like any other.</p>
      {problem ? <p className="mb-2 text-sm text-status-bad">{problem}</p> : null}
      <div className="grid gap-2">
        {plans.map((p) => {
          const w = PLAN_WORDS[p.status];
          return (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={w.tone} title={w.meaning}>{w.label}</Badge>
                  {p.status === "queued" && pos.get(p.id) ? <span className="text-xs text-muted-foreground">{pos.get(p.id) === 1 ? "next on this phone" : `#${pos.get(p.id)} on this phone`}</span> : null}
                  <span className="text-xs text-muted-foreground">{dhakaTime(p.created_at)}</span>
                </div>
                <div className="break-words">{planLine(p, (id) => nameOf(id))}</div>
                {p.error ? <div className="text-xs text-status-warn">{p.error}</div> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {p.status === "queued" ? (
                  <Confirm title="Take this payout back?" description="It has not started. Its transactions become free to pay again." confirmLabel="Take it back" onConfirm={() => cancel(p.id)}>
                    <Button size="sm" variant="outline" disabled={busy === p.id}>Cancel</Button>
                  </Confirm>
                ) : null}
                {p.status === "unsure" || p.status === "sending" ? <Button size="sm" variant="ghost" onClick={() => openPage("payout")}>Open Payout page</Button> : null}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
