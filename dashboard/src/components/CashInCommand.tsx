import { useCallback, useEffect, useRef, useState } from "react";
import { Send, TriangleAlert } from "lucide-react";
import { sb } from "@/lib/supabase";
import { tk, when } from "@/lib/format";
import {
  CASH_IN_AMOUNTS,
  cashInSummary,
  commandLine,
  isLive,
  looksLikeANumber,
  POLL_MS,
  type PhoneCommand,
} from "@/lib/phoneCommands";
import { Button } from "@/components/ui/button";

/** Asks this phone to CASH IN: it opens the wallet's own menu and sends money to a number you type.
 *
 *  This is the one button on the dashboard that moves money, so nothing happens on a single tap: you pick the amount,
 *  type the number, and then confirm a sentence that spells out exactly what will be sent and to whom. The phone checks
 *  the same limits again, and its own wallet must show that number and that amount on screen before the PIN is typed. */
export function CashInCommand({ deviceId, provider }: { deviceId: string; provider: "nagad" | "bkash" }) {
  const label = provider === "bkash" ? "bKash" : "Nagad";
  const [last, setLast] = useState<PhoneCommand | null>(null);
  const [amount, setAmount] = useState<number>(CASH_IN_AMOUNTS[0]);
  const [to, setTo] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    const { data } = await sb
      .from("phone_commands")
      .select("id,kind,provider,status,balance,error,created_at,finished_at,amount,to_number,trx_id")
      .eq("device_id", deviceId)
      .eq("kind", "cashin")
      .eq("provider", provider)
      .order("created_at", { ascending: false })
      .limit(1);
    setLast(((data ?? [])[0] as PhoneCommand | undefined) ?? null);
  }, [deviceId, provider]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!isLive(last)) return;
    timer.current = window.setTimeout(() => void load(), POLL_MS);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [last, load]);

  const number = to.trim();
  const ready = looksLikeANumber(number) && amount > 0 && !busy && !isLive(last);

  async function send() {
    setProblem("");
    setBusy(true);
    const { error } = await sb.rpc("queue_phone_command", {
      p_device: deviceId,
      p_kind: "cashin",
      p_provider: provider,
      p_amount: amount,
      p_to_number: number,
    });
    setBusy(false);
    setConfirming(false);
    if (error) return setProblem(error.message);
    setTo("");
    await load();
  }

  const line = commandLine(last, tk as (n: number) => string, when as (t: string) => string, label);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {CASH_IN_AMOUNTS.map((a) => (
          <Button
            key={a}
            size="sm"
            variant={a === amount ? "default" : "outline"}
            onClick={() => { setAmount(a); setConfirming(false); }}
          >
            {tk(a)}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={to}
          onChange={(e) => { setTo(e.target.value.replace(/[^0-9]/g, "").slice(0, 11)); setConfirming(false); }}
          placeholder="01XXXXXXXXX"
          inputMode="numeric"
          aria-label={`The number to cash in to from this phone's ${label} wallet`}
          className="h-9 w-44 rounded-md border border-input bg-background px-3 text-sm"
        />
        <Button size="sm" onClick={() => { setProblem(""); setConfirming(true); }} disabled={!ready}>
          <Send className="mr-1.5 size-4" /> Send {tk(amount)}
        </Button>
      </div>

      {confirming && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
          <p className="flex items-start gap-2 font-medium">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>{cashInSummary(label, amount, number, tk as (n: number) => string)}</span>
          </p>
          <p className="mt-1 text-muted-foreground">
            This really sends the money. Check the number digit by digit: it cannot be taken back.
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => void send()} disabled={busy}>Yes, send it</Button>
            <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>No</Button>
          </div>
        </div>
      )}

      {line && <p className="text-sm text-muted-foreground">{line}</p>}
      {problem && <p className="text-sm text-rose-600">{problem}</p>}
    </div>
  );
}
