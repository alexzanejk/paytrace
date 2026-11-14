import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRightLeft, Send } from "lucide-react";
import { MoneyConfirm } from "@/components/MoneyConfirm";
import { sb } from "@/lib/supabase";
import { tk, when } from "@/lib/format";
import { errorText, isLive, POLL_MS, type PhoneCommand } from "@/lib/phoneCommands";
import { B2B_AMOUNTS, B2B_KIND, b2bLine, b2bNotes, b2bSummary, cashTick, LEAST_B2B, MOST_B2B, parseB2bAmount } from "@/lib/b2b";
import { nudgePhone } from "@/lib/wake";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/Disclosure";
import { PhoneTrace } from "@/components/PhoneTrace";

/** A B2B from this phone's bKash agent wallet to its DSO, done by the phone in the bKash app (owner 2026-11-10, migration 083).
 *
 *  The bKash app fills in this agent's own DSO by itself, so nothing about the DSO is typed here (owner 2026-11-10: "we don't
 *  need to save the DSO number, it comes from the bKash app"). Nothing happens on one tap: the amount is typed, the owner ticks
 *  that the DSO pays the cash (bKash asks the phone that right after every B2B, and the phone answers yes on this tick), and
 *  then confirms a sentence. The phone holds the send button only on the sheet that shows this amount and the same DSO
 *  number the B2B screen showed. */
export function B2bCommand({ deviceId }: { deviceId: string }) {
  const [last, setLast] = useState<PhoneCommand | null>(null);
  const [lastDso, setLastDso] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [cashOk, setCashOk] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    const { data } = await sb.from("phone_commands")
      .select("id,kind,provider,status,balance,error,created_at,finished_at,amount,to_number,trx_id,screens")
      .eq("device_id", deviceId).eq("kind", B2B_KIND)
      .order("created_at", { ascending: false }).limit(5);
    const rows = (data ?? []) as PhoneCommand[];
    setLast(rows[0] ?? null);
    // The DSO number the phone saw in the bKash app on a finished B2B, only to show it.
    setLastDso(rows.find((r) => r.to_number)?.to_number ?? null);
  }, [deviceId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!isLive(last)) return;
    timer.current = window.setTimeout(() => void load(), POLL_MS);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [last, load]);

  const amount = parseB2bAmount(typed);
  const ready = amount != null && cashOk && !busy && !isLive(last);

  async function send() {
    if (amount == null) return;
    setProblem("");
    setBusy(true);
    const { error } = await sb.rpc("queue_b2b", { p_device: deviceId, p_provider: "bkash", p_amount: amount, p_cash_ok: cashOk });
    setBusy(false);
    setConfirming(false);
    if (error) {
      const words: Record<string, string> = {
        sending_money_off: "Sending money is switched off for this phone (\"What the dashboard may do\" above).",
        b2b_already_waiting: "A B2B is already waiting or running on this phone.",
        b2b_cash_not_confirmed: "Tick that the DSO pays the cash first.",
        bad_amount: `Type an amount between ${tk(LEAST_B2B)} and ${tk(MOST_B2B)}.`,
      };
      return setProblem(words[error.message] ?? error.message);
    }
    nudgePhone(deviceId);
    setTyped("");
    setCashOk(false);
    await load();
  }

  const line = b2bLine(last, tk as (n: number) => string, when as (t: string) => string, (c) => errorText(c, "bKash"));
  const notes = last?.status === "done" ? b2bNotes(last) : [];
  const input = "h-9 rounded-md border border-input bg-background px-3 text-sm";

  return (
    <Disclosure icon={ArrowRightLeft} title="B2B to the DSO (bKash app)" summary={lastDso ? `DSO ${lastDso}` : "bKash app"}>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          The phone opens the bKash app, goes to B2B Transfer (bKash fills in this agent&apos;s own DSO), types the amount and the
          PIN slowly, and holds the send button only when the app shows this amount and the same DSO number all the way through. bKash sends no SMS for a B2B; the phone reads the app&apos;s
          transaction list right after, so the ledger and the B2B float see it within a minute or two.
        </p>

        {lastDso ? <p className="text-sm text-muted-foreground">DSO on the last B2B: <span className="font-medium tabular">{lastDso}</span></p> : null}

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-muted-foreground" htmlFor={`b2b-amount-${deviceId}`}>Amount (Tk)</label>
          <input
            id={`b2b-amount-${deviceId}`}
            value={typed}
            onChange={(e) => { setTyped(e.target.value); setConfirming(false); setCashOk(false); }}
            placeholder={`${LEAST_B2B} to ${MOST_B2B.toLocaleString("en-US")}`}
            inputMode="decimal"
            className={`${input} w-36 tabular`}
          />
          <div className="flex flex-wrap gap-1.5">
            {B2B_AMOUNTS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => { setTyped(String(a)); setConfirming(false); setCashOk(false); }}
                className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${amount === a ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}
              >
                {a.toLocaleString("en-US")}
              </button>
            ))}
          </div>
        </div>
        {typed && amount == null ? (
          <p className="text-xs text-status-bad">Type an amount between {tk(LEAST_B2B)} and {tk(MOST_B2B)} (two decimals at most).</p>
        ) : null}

        {amount != null ? (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={cashOk} onChange={(e) => { setCashOk(e.target.checked); setConfirming(false); }} />
            <span>{cashTick(amount, tk as (n: number) => string)}</span>
          </label>
        ) : null}

        <Button size="sm" onClick={() => { setProblem(""); setConfirming(true); }} disabled={!ready}>
          <Send className="mr-1.5 size-4" /> B2B{amount != null ? ` ${tk(amount)}` : ""}
        </Button>

        {confirming && amount != null ? (
          <MoneyConfirm
            yes="Yes, B2B it"
            busy={busy}
            onYes={() => void send()}
            onBack={() => setConfirming(false)}
            note="This really moves the money. It cannot be taken back."
          >
            {b2bSummary(amount, tk as (n: number) => string, lastDso)}
          </MoneyConfirm>
        ) : null}

        {line ? <p className="text-sm text-muted-foreground">{line}</p> : null}
        {notes.map((n) => <p key={n} className="text-sm text-muted-foreground">{n}</p>)}
        {last && last.status !== "queued" && last.status !== "running" ? (
          <PhoneTrace screens={last.screens} label="How the phone did it" />
        ) : null}
        {problem ? <p className="text-sm text-status-bad">{problem}</p> : null}
      </div>
    </Disclosure>
  );
}
