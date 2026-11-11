import { useCallback, useEffect, useRef, useState } from "react";
import { Send, TriangleAlert } from "lucide-react";
import { sb } from "@/lib/supabase";
import { tk, when } from "@/lib/format";
import {
  type WalletName, walletLabel,
  CASH_IN_AMOUNTS, LEAST_PER_CASH_IN, MOST_PER_CASH_IN,
  cashInSummary,
  commandLine,
  isLive,
  numberLabel,
  parseCashInAmount,
  POLL_MS,
  type PhoneCommand,
  type SavedNumber,
} from "@/lib/phoneCommands";
import { nudgePhone } from "@/lib/wake";
import { Button } from "@/components/ui/button";
import { PhoneTrace } from "@/components/PhoneTrace";
import { SendWayChoice } from "@/components/SendWayChoice";
import { type SendWay, wayWords } from "@/lib/sendWay";

/** Asks this phone to CASH IN: it opens the wallet's own menu and sends money to one of your saved cash-in numbers.
 *
 *  This is the one button on the dashboard that moves money, so nothing happens on a single tap: you type the exact
 *  amount (100 to 50,000; owner 2026-11-04), pick the number from the saved list (never typed, so a typo cannot send
 *  money to a stranger), and then confirm a sentence that spells out exactly what will be sent and to whom. The
 *  database and the phone check the same bounds again, and the wallet's own screen must show that number and that
 *  amount before the PIN is typed. */
export function CashInCommand({ deviceId, provider }: { deviceId: string; provider: WalletName }) {
  const label = walletLabel(provider);
  const [last, setLast] = useState<PhoneCommand | null>(null);
  const [typed, setTyped] = useState("");
  const [numbers, setNumbers] = useState<SavedNumber[]>([]);
  const [to, setTo] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [way, setWay] = useState<SendWay>("ussd");
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    const [{ data }, { data: nums }] = await Promise.all([
      sb.from("phone_commands")
        .select("id,kind,provider,status,balance,error,created_at,finished_at,amount,to_number,trx_id,screens")
        .eq("device_id", deviceId).eq("kind", "cashin").eq("provider", provider)
        .order("created_at", { ascending: false }).limit(1),
      sb.from("cashin_numbers").select("id,provider,number,label,enabled").eq("provider", provider).eq("enabled", true).order("created_at"),
    ]);
    setLast(((data ?? [])[0] as PhoneCommand | undefined) ?? null);
    setNumbers((nums ?? []) as SavedNumber[]);
  }, [deviceId, provider]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!isLive(last)) return;
    timer.current = window.setTimeout(() => void load(), POLL_MS);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [last, load]);

  const amount = parseCashInAmount(typed);
  const chosen = numbers.find((n) => n.number === to) ?? null;
  const ready = amount != null && chosen != null && !busy && !isLive(last);

  async function send() {
    if (amount == null || !chosen) return;
    setProblem("");
    setBusy(true);
    const { error } = await sb.rpc("queue_phone_command_via", {
      p_device: deviceId,
      p_kind: "cashin",
      p_provider: provider,
      p_amount: amount,
      p_to_number: chosen.number,
      p_via: way,
    });
    setBusy(false);
    setConfirming(false);
    if (error) return setProblem(error.message);
    // Wake the phone so it takes this now rather than on its next 30-second beat. It is queued either way.
    nudgePhone(deviceId);
    setTyped("");
    await load();
  }

  const line = commandLine(last, tk as (n: number) => string, when as (t: string) => string, label);
  const input = "h-9 rounded-md border border-input bg-background px-3 text-sm";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-muted-foreground" htmlFor={`ci-amount-${deviceId}-${provider}`}>Amount (Tk)</label>
        <input
          id={`ci-amount-${deviceId}-${provider}`}
          value={typed}
          onChange={(e) => { setTyped(e.target.value); setConfirming(false); }}
          placeholder={`${LEAST_PER_CASH_IN} to ${MOST_PER_CASH_IN.toLocaleString("en-US")}`}
          inputMode="decimal"
          className={`${input} w-36 tabular`}
        />
        <div className="flex flex-wrap gap-1.5">
          {CASH_IN_AMOUNTS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => { setTyped(String(a)); setConfirming(false); }}
              className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${amount === a ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}
            >
              {a.toLocaleString("en-US")}
            </button>
          ))}
        </div>
      </div>
      {typed && amount == null ? (
        <p className="text-xs text-rose-600">Type a whole amount between {tk(LEAST_PER_CASH_IN)} and {tk(MOST_PER_CASH_IN)} (paisa allowed, two decimals at most).</p>
      ) : null}

      <SendWayChoice deviceId={deviceId} provider={provider} account="agent" method="cash_in" value={way} onChange={(w) => { setWay(w); setConfirming(false); }} />

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-muted-foreground" htmlFor={`ci-to-${deviceId}-${provider}`}>Send to</label>
        {numbers.length === 0 ? (
          <span className="text-sm text-muted-foreground">
            No saved {label} cash-in number yet. Add one on the Jobs page (Cash-in jobs → numbers); money can only be sent to a saved number.
          </span>
        ) : (
          <select
            id={`ci-to-${deviceId}-${provider}`}
            value={to}
            onChange={(e) => { setTo(e.target.value); setConfirming(false); }}
            className={`${input} max-w-full`}
            aria-label={`Which saved ${label} number to cash in to`}
          >
            <option value="">Choose a saved number…</option>
            {numbers.map((n) => <option key={n.id} value={n.number}>{numberLabel(n)}</option>)}
          </select>
        )}
        <Button size="sm" onClick={() => { setProblem(""); setConfirming(true); }} disabled={!ready}>
          <Send className="mr-1.5 size-4" /> Send{amount != null ? ` ${tk(amount)}` : ""}
        </Button>
      </div>

      {confirming && amount != null && chosen && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
          <p className="flex items-start gap-2 font-medium">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>{cashInSummary(label, amount, numberLabel(chosen), tk as (n: number) => string)} Sent {wayWords(way, provider)}.</span>
          </p>
          <p className="mt-1 text-muted-foreground">
            This really sends the money. Check the amount and the number: it cannot be taken back.
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => void send()} disabled={busy}>Yes, send it</Button>
            <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>No</Button>
          </div>
        </div>
      )}

      {line && <p className="text-sm text-muted-foreground">{line}</p>}
      {last && (last.status === "failed" || last.status === "cancelled") ? <PhoneTrace screens={last.screens} /> : null}
      {problem && <p className="text-sm text-rose-600">{problem}</p>}
    </div>
  );
}
