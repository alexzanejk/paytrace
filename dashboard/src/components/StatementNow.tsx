import { useState } from "react";
import { ArrowLeftRight, HandCoins } from "lucide-react";
import { sb } from "@/lib/supabase";
import { nudgePhone } from "@/lib/wake";
import { statementNowText, type StatementNowAnswer } from "@/lib/statementNow";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const WALLET: Record<string, string> = { bkash: "bKash", nagad: "Nagad" };

/** Two buttons under an agent wallet's day: tell PayTrace a B2B or a Cash In was just made by hand, and the phone reads the
 *  wallet's statement at once (no SMS comes for those, so otherwise they wait for the next SMS or the midnight read). */
export function StatementNow({ deviceId, provider }: { deviceId: string; provider: string }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const wallet = WALLET[provider] ?? provider;

  async function ask(why: "b2b" | "cashin") {
    setBusy(true);
    setNote(null);
    const { data, error } = await sb.rpc("ask_statement_now", { p_device: deviceId, p_provider: provider, p_why: why });
    const answer = error ? null : (data as StatementNowAnswer);
    if (answer?.queued) nudgePhone(deviceId);
    setNote(statementNowText(answer, wallet));
    setBusy(false);
  }

  return (
    <div className="mt-2 space-y-1">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void ask("b2b")}>
          <ArrowLeftRight aria-hidden /> We did a B2B
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void ask("cashin")}>
          <HandCoins aria-hidden /> We did a Cash In
        </Button>
      </div>
      {note ? <p className={cn("text-xs", note.ok ? "text-muted-foreground" : "text-status-warn")}>{note.text}</p> : null}
    </div>
  );
}
