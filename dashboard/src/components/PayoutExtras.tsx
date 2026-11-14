import { useState } from "react";
import { HandCoins, Pencil, Plus } from "lucide-react";
import { Confirm } from "@/components/Confirm";
import { sb } from "@/lib/supabase";
import { tk, when } from "@/lib/format";
import { PROVIDERS, PROVIDER_LABEL } from "@/lib/types";
import { extraSplit, parsePct, payoutLine, type PayoutRow } from "@/lib/payouts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

const errText = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));

/** The share you keep by default (owner 2026-11-13: "no option to change the default 20%"). One setting for every
 *  payout, whatever site or phone the money came from; each payout can still change it for itself. */
export function DefaultShare({ pct, onSaved }: { pct: number; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(String(pct));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const value = parsePct(text);

  async function save() {
    if (value == null) return;
    setBusy(true); setProblem("");
    const r = await sb.rpc("set_payout_settings", { p_keep_pct: value });
    setBusy(false);
    if (r.error) { setProblem(r.error.message); return; }
    setEditing(false);
    onSaved();
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span>Default share you keep: <strong className="tabular">{pct}%</strong></span>
        <span className="text-xs text-muted-foreground">for every payout, all sites and phones</span>
        <Button size="sm" variant="outline" onClick={() => { setText(String(pct)); setEditing(true); }}>
          <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden /> Change
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-1 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="default-share">Default share you keep (%)</label>
        <Input id="default-share" className="w-24" inputMode="decimal" value={text} autoFocus onChange={(e) => setText(e.target.value)} />
        <Button size="sm" disabled={value == null || busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
      </div>
      {value == null ? <p className="text-xs text-status-warn">Type a number from 0 to 100.</p> : null}
      <p className="text-xs text-muted-foreground">Used for new payouts from now on. Payouts already made keep the share they were made with.</p>
      {problem ? <p className="text-xs text-status-bad">{problem}</p> : null}
    </div>
  );
}

/** Record money you paid out on a transaction that is NOT on the Payout list (owner 2026-11-13), for example a Cash Out
 *  that the wallet's own app showed with no SMS. Nothing is sent: it is only written down as paid. */
export function ExtraPayoutForm({
  defaultPct, phones, onDone, onClose, onFind,
}: {
  defaultPct: number;
  phones: { value: string; label: string }[];
  onDone: () => void;
  onClose: () => void;
  /** Show a transaction PayTrace already holds in the list below, so it is ticked there instead. */
  onFind: (trx: string) => void;
}) {
  const [forTrx, setForTrx] = useState("");
  const [received, setReceived] = useState("");
  const [sent, setSent] = useState("");
  const [device, setDevice] = useState("");
  const [provider, setProvider] = useState("");
  const [number, setNumber] = useState("");
  const [trx, setTrx] = useState("");
  const [day, setDay] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [listed, setListed] = useState("");

  const split = extraSplit(received, sent, defaultPct);
  const cleanFor = forTrx.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const whatFor = cleanFor || note.trim() ? "" : "Type the TrxID of the transaction you paid on, or a note saying what it was for.";
  const ready = "keep" in split && !whatFor && !busy;

  async function save() {
    if (!("keep" in split)) return;
    setBusy(true); setProblem(""); setListed("");
    const r = await sb.rpc("manual_payout_extra", {
      p_received: split.received, p_sent: split.sent, p_for_trx: cleanFor || null, p_device: device || null, p_provider: provider || null,
      p_to_number: number.trim() || null, p_trx: trx.trim() || null, p_paid_on: day || null, p_note: note.trim() || null,
    });
    setBusy(false);
    if (r.error) {
      const msg = errText(r.error);
      if (msg.startsWith("listed: ")) { setListed(msg.slice(8)); return; }
      setProblem(msg);
      return;
    }
    onDone();
  }

  return (
    <Card className="mb-5 space-y-4 border-primary/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold"><HandCoins className="mr-1 inline h-4 w-4" aria-hidden /> Add a payout paid by hand</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        For money you already paid out on a transaction that is not in the list below, for example a Cash Out the wallet's
        own app showed with no SMS. Nothing is sent: it is only recorded as paid. A transaction that IS in the list should be
        ticked there instead.
      </p>

      <div className="grid gap-3 md:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">TrxID of the transaction you paid on</span>
          <Input className="font-mono" autoComplete="off" value={forTrx} onChange={(e) => { setForTrx(e.target.value); setListed(""); }} placeholder="e.g. DKB1CVD04L" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Amount that came in</span>
          <Input inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value)} placeholder="Tk" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Amount you paid out</span>
          <Input inputMode="decimal" value={sent} onChange={(e) => setSent(e.target.value)} placeholder={`empty = keep ${defaultPct}%`} />
        </label>
      </div>
      {"keep" in split ? (
        <p className="text-sm">
          Paid out <strong className="tabular">{tk(split.sent)}</strong>, you keep <strong className="tabular">{tk(split.keep)}</strong> ({split.pct}%) of {tk(split.received)}.
        </p>
      ) : received || sent ? <p className="text-sm text-status-warn">{split.problem}</p> : null}

      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Phone it came in on (optional)</span>
          <select className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm" value={device} onChange={(e) => setDevice(e.target.value)}>
            <option value="">Not saying</option>
            {phones.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Wallet (optional)</span>
          <select className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm" value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="">Not saying</option>
            {PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Number you paid to (optional)</span>
          <Input inputMode="tel" autoComplete="off" placeholder="01XXXXXXXXX" value={number} onChange={(e) => setNumber(e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">TrxID of your payment (optional)</span>
          <Input className="font-mono" autoComplete="off" value={trx} onChange={(e) => setTrx(e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Day you paid (empty = today)</span>
          <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Note {cleanFor ? "(optional)" : "(needed without a TrxID)"}</span>
          <Input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>

      {listed ? (
        <div className="space-y-2 rounded-lg border border-status-warn bg-status-warn-bg p-3 text-sm text-status-warn">
          <p>{listed}</p>
          {cleanFor ? <Button size="sm" variant="outline" onClick={() => onFind(cleanFor)}>Show it in the list</Button> : null}
        </div>
      ) : null}
      {whatFor && "keep" in split ? <p className="text-sm text-status-warn">{whatFor}</p> : null}
      {problem ? <p className="rounded-lg bg-status-bad-bg p-3 text-sm text-status-bad">{problem}</p> : null}

      <Button disabled={!ready} onClick={() => void save()}>{busy ? "Saving…" : "Record as paid"}</Button>
    </Card>
  );
}

/** Payouts recorded by hand for money not on the list, newest first, each with Undo. */
export function ExtraPayoutList({ rows, nameOf, onDone, onAdd }: {
  rows: PayoutRow[];
  nameOf: (id: string | null | undefined) => string;
  onDone: () => void;
  onAdd: () => void;
}) {
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState("");
  const live = rows.filter((p) => p.status === "paid");
  async function undo(p: PayoutRow) {
    setBusy(p.id); setProblem("");
    const r = await sb.rpc("resolve_payout", { p_payout: p.id, p_sent: false, p_trx: null });
    setBusy("");
    if (r.error) setProblem(r.error.message); else onDone();
  }
  return (
    <Card className="mt-5 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
        <h2 className="text-sm font-semibold">Paid by hand, not in the list ({live.length})</h2>
        <Button size="sm" variant="outline" onClick={onAdd}><Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> Add one</Button>
      </div>
      {!live.length ? <p className="px-4 py-4 text-sm text-muted-foreground">None yet.</p> : null}
      <ul className="divide-y divide-border">
        {live.map((p) => (
          <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-sm">
            <div className="min-w-0 space-y-0.5">
              <p className="font-medium">{payoutLine(p, nameOf)}</p>
              <p className="text-xs text-muted-foreground">
                Paid {when(p.paid_at ?? p.created_at)}
                {p.for_device || p.for_provider ? ` · came in on ${p.for_device ? nameOf(p.for_device) : ""}${p.for_provider ? ` ${PROVIDER_LABEL[p.for_provider as keyof typeof PROVIDER_LABEL] ?? p.for_provider}` : ""}` : ""}
                {p.note ? ` · ${p.note}` : ""}
              </p>
            </div>
            <Confirm
              title={`Undo the ${tk(Number(p.send_amount))} recorded by hand${p.for_trx ? ` for ${p.for_trx}` : ""}?`}
              description="The record is removed from this list. Do this only if the money was not really paid."
              confirmLabel="Undo"
              onConfirm={() => undo(p)}
            >
              <Button size="sm" variant="outline" disabled={busy === p.id}>Undo</Button>
            </Confirm>
          </li>
        ))}
      </ul>
      {problem ? <p className="px-4 pb-3 text-xs text-status-bad">{problem}</p> : null}
    </Card>
  );
}
