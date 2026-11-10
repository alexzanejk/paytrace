import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRightLeft, Send, TriangleAlert } from "lucide-react";
import { sb } from "@/lib/supabase";
import { tk, when } from "@/lib/format";
import { errorText, isLive, POLL_MS, type PhoneCommand } from "@/lib/phoneCommands";
import { B2B_AMOUNTS, B2B_KIND, b2bLine, b2bNotes, b2bSummary, cashTick, LEAST_B2B, MOST_B2B, normalizeDso, parseB2bAmount } from "@/lib/b2b";
import { nudgePhone } from "@/lib/wake";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/Disclosure";
import { PhoneTrace } from "@/components/PhoneTrace";

/** A B2B from this phone's bKash agent wallet to its DSO, done by the phone in the bKash app (owner 2026-11-10, migration 083).
 *
 *  The bKash app fills in the DSO by itself; the DSO number saved here is what the phone checks the app's screens against,
 *  so a B2B can only go to that number. Nothing happens on one tap: the amount is typed, the owner ticks that the DSO pays
 *  the cash (bKash asks the phone that right after every B2B, and the phone answers yes on this tick), and then confirms
 *  a sentence. The phone holds the send button only on the sheet that shows this DSO number and this amount. */
export function B2bCommand({ deviceId }: { deviceId: string }) {
  const [last, setLast] = useState<PhoneCommand | null>(null);
  const [dso, setDso] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [n1, setN1] = useState("");
  const [n2, setN2] = useState("");
  const [typed, setTyped] = useState("");
  const [cashOk, setCashOk] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    const [{ data }, { data: num }] = await Promise.all([
      sb.from("phone_commands")
        .select("id,kind,provider,status,balance,error,created_at,finished_at,amount,to_number,trx_id,screens")
        .eq("device_id", deviceId).eq("kind", B2B_KIND)
        .order("created_at", { ascending: false }).limit(1),
      sb.from("b2b_numbers").select("number").eq("device_id", deviceId).eq("provider", "bkash").maybeSingle(),
    ]);
    setLast(((data ?? [])[0] as PhoneCommand | undefined) ?? null);
    setDso((num as { number?: string } | null)?.number ?? null);
  }, [deviceId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!isLive(last)) return;
    timer.current = window.setTimeout(() => void load(), POLL_MS);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [last, load]);

  const first = normalizeDso(n1);
  const sameTwice = first != null && first === normalizeDso(n2);

  async function saveDso() {
    if (!sameTwice) return;
    setProblem("");
    setBusy(true);
    const { error } = await sb.rpc("set_b2b_number", { p_device: deviceId, p_provider: "bkash", p_number: first });
    setBusy(false);
    if (error) return setProblem(error.message);
    setEditing(false);
    setN1(""); setN2("");
    await load();
  }

  const amount = parseB2bAmount(typed);
  const ready = dso != null && amount != null && cashOk && !busy && !isLive(last);

  async function send() {
    if (amount == null || !dso) return;
    setProblem("");
    setBusy(true);
    const { error } = await sb.rpc("queue_b2b", { p_device: deviceId, p_provider: "bkash", p_amount: amount, p_cash_ok: cashOk });
    setBusy(false);
    setConfirming(false);
    if (error) {
      const words: Record<string, string> = {
        no_dso_number: "Save the DSO number first.",
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
    <Disclosure icon={ArrowRightLeft} title="B2B to the DSO (bKash app)" summary={dso ? `DSO ${dso}` : "DSO number not saved"}>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          The phone opens the bKash app, types the amount and the PIN slowly, and holds the send button only when the app shows
          exactly the DSO number saved here and this amount. bKash sends no SMS for a B2B; the phone reads the app&apos;s
          transaction list right after, so the ledger and the B2B float see it within a minute or two.
        </p>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">DSO number</span>
          <span className="font-medium tabular">{dso ?? "not saved"}</span>
          {!editing ? (
            <Button size="sm" variant="outline" onClick={() => { setEditing(true); setProblem(""); }}>{dso ? "Change" : "Save the DSO number"}</Button>
          ) : null}
        </div>
        {editing ? (
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-xs text-muted-foreground">
              The number the bKash app shows under &quot;ডিএসও&quot; on its B2B screen. Type it twice.
            </p>
            <div className="flex flex-wrap gap-2">
              <input value={n1} onChange={(e) => setN1(e.target.value)} placeholder="01XXXXXXXXX" inputMode="tel" className={`${input} w-40 tabular`} aria-label="DSO number" />
              <input value={n2} onChange={(e) => setN2(e.target.value)} onPaste={(e) => e.preventDefault()} placeholder="Type it again" inputMode="tel" className={`${input} w-40 tabular`} aria-label="DSO number again" />
              <Button size="sm" onClick={() => void saveDso()} disabled={!sameTwice || busy}>Save</Button>
              <Button size="sm" variant="outline" onClick={() => { setEditing(false); setN1(""); setN2(""); }}>Cancel</Button>
            </div>
            {n1 && !first ? <p className="text-xs text-rose-600">An 11-digit number starting 01.</p> : null}
            {first && n2 && !sameTwice ? <p className="text-xs text-rose-600">The two numbers differ.</p> : null}
          </div>
        ) : null}

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
          <p className="text-xs text-rose-600">Type an amount between {tk(LEAST_B2B)} and {tk(MOST_B2B)} (two decimals at most).</p>
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

        {confirming && amount != null && dso ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
            <p className="flex items-start gap-2 font-medium">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>{b2bSummary(amount, dso, tk as (n: number) => string)}</span>
            </p>
            <p className="mt-1 text-muted-foreground">This really moves the money. It cannot be taken back.</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={() => void send()} disabled={busy}>Yes, B2B it</Button>
              <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>No</Button>
            </div>
          </div>
        ) : null}

        {line ? <p className="text-sm text-muted-foreground">{line}</p> : null}
        {notes.map((n) => <p key={n} className="text-sm text-muted-foreground">{n}</p>)}
        {last && last.status !== "queued" && last.status !== "running" ? (
          <PhoneTrace screens={last.screens} label="How the phone did it" />
        ) : null}
        {problem ? <p className="text-sm text-rose-600">{problem}</p> : null}
      </div>
    </Disclosure>
  );
}
