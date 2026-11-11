import { useCallback, useEffect, useRef, useState } from "react";
import { Wallet } from "lucide-react";
import { sb } from "@/lib/supabase";
import { tk, when } from "@/lib/format";
import { commandLine, isLive, POLL_MS, type PhoneCommand, type WalletName, walletLabel } from "@/lib/phoneCommands";
import { nudgePhone } from "@/lib/wake";
import { Button } from "@/components/ui/button";
import { PhoneTrace } from "@/components/PhoneTrace";
import { appBalanceFor } from "@/lib/sendWay";

/** Asks this phone to read a wallet's balance through the provider's own USSD menu, or for bKash through the bKash app
 *  (migration 089, owner 2026-11-11). Nothing is sent or spent: it only reads. */
export function BalanceCheck({ deviceId, provider = "nagad", appBalance, appNagad }: { deviceId: string; provider?: WalletName; appBalance?: unknown; appNagad?: unknown }) {
  const label = walletLabel(provider);
  const [last, setLast] = useState<PhoneCommand | null>(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    const { data } = await sb
      .from("phone_commands")
      .select("id,kind,provider,status,balance,error,created_at,finished_at,screens,via")
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

  async function ask(via: "ussd" | "app") {
    setProblem("");
    setBusy(true);
    const { error } = via === "app"
      ? await sb.rpc("queue_balance_via", { p_device: deviceId, p_provider: provider, p_via: "app" })
      : await sb.rpc("queue_phone_command", { p_device: deviceId, p_kind: "balance", p_provider: provider });
    setBusy(false);
    if (error) return setProblem(error.message);
    // Wake the phone so it takes this now rather than on its next 30-second beat. It is queued either way.
    nudgePhone(deviceId);
    await load();
  }

  const app = appBalanceFor(provider, appBalance, appNagad);
  const appName = provider === "nagad" ? "Nagad app" : "bKash app";
  const line = commandLine(last, tk as (n: number) => string, when as (t: string) => string, label);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="outline" onClick={() => void ask("ussd")} disabled={busy || isLive(last)}>
          <Wallet aria-hidden /> {isLive(last) ? "Checking…" : `Check ${label} balance`}
        </Button>
        {provider === "bkash" || provider === "nagad" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void ask("app")}
            disabled={busy || isLive(last) || !app.ok}
            title={app.ok ? `Opens the ${appName}, signs in and taps for the balance. Only reads.` : app.why}
          >
            <Wallet aria-hidden /> Check in {appName}
          </Button>
        ) : null}
        {line ? <span role="status" className="text-sm text-muted-foreground">{line}</span> : null}
        {problem ? <span className="text-xs text-destructive">{problem}</span> : null}
      </div>
      {last && (last.status === "failed" || last.status === "cancelled") ? <PhoneTrace screens={last.screens} /> : null}
    </div>
  );
}
