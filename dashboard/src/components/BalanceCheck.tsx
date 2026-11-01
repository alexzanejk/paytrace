import { useCallback, useEffect, useRef, useState } from "react";
import { Wallet } from "lucide-react";
import { sb } from "@/lib/supabase";
import { tk, when } from "@/lib/format";
import { commandLine, isLive, POLL_MS, type PhoneCommand } from "@/lib/phoneCommands";
import { Button } from "@/components/ui/button";

/** Asks this phone to read a wallet's balance (Nagad or bKash) through the provider's own USSD menu. Nothing is sent or spent: it only reads.
 *  The phone picks the request up on its next 30-second check and answers within about a minute and a half. */
export function BalanceCheck({ deviceId, provider = "nagad" }: { deviceId: string; provider?: "nagad" | "bkash" }) {
  const label = provider === "bkash" ? "bKash" : "Nagad";
  const [last, setLast] = useState<PhoneCommand | null>(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    const { data } = await sb
      .from("phone_commands")
      .select("id,kind,provider,status,balance,error,created_at,finished_at")
      .eq("device_id", deviceId)
      .eq("kind", "balance")
      .eq("provider", provider)
      .order("created_at", { ascending: false })
      .limit(1);
    setLast(((data ?? [])[0] as PhoneCommand | undefined) ?? null);
  }, [deviceId, provider]);

  useEffect(() => { void load(); }, [load]);

  // While the phone has not finished, look again every few seconds.
  useEffect(() => {
    if (!isLive(last)) return;
    timer.current = window.setTimeout(() => void load(), POLL_MS);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [last, load]);

  async function ask() {
    setProblem("");
    setBusy(true);
    const { error } = await sb.rpc("queue_phone_command", { p_device: deviceId, p_kind: "balance", p_provider: provider });
    setBusy(false);
    if (error) return setProblem(error.message);
    await load();
  }

  const line = commandLine(last, tk as (n: number) => string, when as (t: string) => string, label);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" variant="outline" onClick={() => void ask()} disabled={busy || isLive(last)}>
        <Wallet aria-hidden /> {isLive(last) ? "Checking…" : `Check ${label} balance`}
      </Button>
      {line ? <span role="status" className="text-sm text-muted-foreground">{line}</span> : null}
      {problem ? <span className="text-xs text-destructive">{problem}</span> : null}
    </div>
  );
}
