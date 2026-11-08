import { useMemo, useState } from "react";
import { CheckCircle2, HandCoins, TriangleAlert } from "lucide-react";
import { must, sb } from "@/lib/supabase";
import { tk, when } from "@/lib/format";
import { dhakaDay } from "@/lib/period";
import type { Device } from "@/lib/types";
import {
  DAY_WORDS, UNSURE_HELP, carryOf, partnersOwed, payLine, payable, sendOptions, sizeProblem, splitCommission,
  type CommissionDayRow, type CommissionPayRow, type PayDayRow,
} from "@/lib/commissionPays";
import { nudgePhone } from "@/lib/wake";
import { useQuery } from "@/hooks/useQuery";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const addDays = (day: string, n: number) => {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayLabel = (day: string) => new Date(day + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const errText = (e: unknown) => String((e as { message?: string })?.message ?? e).replace(/^send_money_not_ready: /, "");

/** Daily payouts (owner 2026-11-08): each partner's commission for one day is due after 11:59 PM and is paid by Cash In from
 *  the partner's own agent wallet, by Send Money from a personal bKash (the bKash fee comes off the commission), or marked
 *  paid by hand. A day can be in only one live payment (the database enforces it). */
export function DailyPayouts({ devices, nameOf }: { devices: Device[]; nameOf: (id: string | null | undefined) => string }) {
  const from = addDays(dhakaDay(), -62);
  const { data, error, refresh } = useQuery(
    async () => {
      const rows = must(await sb.rpc("commission_days", { p_from: from })) as CommissionDayRow[];
      const pays = must(await sb.from("commission_pays").select("*").order("created_at", { ascending: false }).limit(300)) as CommissionPayRow[];
      const days = must(await sb.from("commission_pay_days").select("pay_id,device_id,day,amount,live").gte("day", from)) as PayDayRow[];
      const fee = must(await sb.from("payout_settings").select("send_money_fee").limit(1)) as { send_money_fee?: number | string }[];
      return { rows, pays, days, fee: Number(fee[0]?.send_money_fee ?? 10) };
    },
    [from],
    { refreshMs: 10000 },
  );
  const rows = data?.rows ?? [];
  const pays = data?.pays ?? [];
  const owed = partnersOwed(rows);
  const [partner, setPartner] = useState("");
  const chosen = partner || owed[0]?.deviceId || "";
  const live = pays.filter((p) => p.status === "sending" || p.status === "unsure");

  if (error) return <Card className="mt-5 p-4 text-sm text-status-bad">Could not load the daily payouts: {error}</Card>;

  return (
    <Card className="mt-5 space-y-4 p-4">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold"><HandCoins className="h-4 w-4" aria-hidden /> Daily payouts</h2>
        <p className="text-xs text-muted-foreground">
          Each partner's commission for one day (12:00 AM to 11:59 PM, agent Cash Out only) becomes due after 11:59 PM. Pay it by Cash In from their own
          agent wallet (no charge), by Send Money from your personal bKash (the bKash fee comes off the commission), or mark it paid by hand. Whole taka is
          sent; the paisa left over is added to the partner's next payment.
        </p>
      </div>

      {live.length ? (
        <div className="space-y-2">
          {live.map((p) => <LivePay key={p.id} p={p} nameOf={nameOf} onDone={refresh} />)}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {owed.length === 0 ? <p className="text-sm text-muted-foreground">Nothing is due. Every finished day is paid.</p> : null}
        {owed.map((o) => (
          <button
            key={o.deviceId}
            type="button"
            onClick={() => setPartner(o.deviceId)}
            className={`rounded-lg border px-3 py-2 text-left text-sm ${chosen === o.deviceId ? "border-primary bg-primary/5" : "border-input hover:bg-muted"}`}
          >
            <span className="block font-medium">{nameOf(o.deviceId)}</span>
            <span className="text-xs text-muted-foreground">{tk(o.due)} due · {o.days} day{o.days === 1 ? "" : "s"}</span>
          </button>
        ))}
      </div>

      {chosen ? (
        <PartnerDays
          key={chosen}
          partnerId={chosen}
          rows={rows.filter((r) => r.device_id === chosen)}
          pays={pays}
          payDays={data?.days ?? []}
          devices={devices}
          nameOf={nameOf}
          fee={data?.fee ?? 10}
          onDone={refresh}
        />
      ) : null}
    </Card>
  );
}

function PartnerDays({
  partnerId, rows, pays, payDays, devices, nameOf, fee, onDone,
}: {
  partnerId: string;
  rows: CommissionDayRow[];
  pays: CommissionPayRow[];
  payDays: PayDayRow[];
  devices: Device[];
  nameOf: (id: string | null | undefined) => string;
  fee: number;
  onDone: () => void;
}) {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [optionKey, setOptionKey] = useState("");
  const [byHand, setByHand] = useState(false);
  const [trx, setTrx] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  const partner = devices.find((d) => d.id === partnerId);
  const number = partner?.commission_number ?? null;
  const payById = useMemo(() => new Map(pays.map((p) => [p.id, p])), [pays]);
  const options = useMemo(
    () => sendOptions(partnerId, devices.map((d) => ({ id: d.id, name: nameOf(d.id), status: d.status, allow_cashin: d.allow_cashin, allow_personal: d.allow_personal, info: d.info }))),
    [partnerId, devices, nameOf],
  );
  const option = options.find((o) => o.key === (optionKey || options.find((x) => !x.why)?.key));
  const due = rows.filter((r) => ticked.has(r.day)).reduce((s, r) => s + Number(r.due), 0);
  const carry = carryOf(pays, partnerId);
  const split = splitCommission(due, carry, !byHand && option?.method === "send_money" ? fee : 0);
  const blocked = ticked.size === 0 ? "Tick at least one due day."
    : byHand ? ""
    : !number ? "Save the number this partner's commission goes to first (Phones page, this phone's Partner commission)."
    : !option ? "No wallet can send this: the partner's phone has no bKash/Nagad agent wallet saved, and no phone has a personal bKash."
    : option.why || sizeProblem(split.send);

  function toggle(day: string) {
    setTicked((t) => { const n = new Set(t); if (n.has(day)) n.delete(day); else n.add(day); return n; });
    setConfirming(false);
  }

  async function go() {
    setBusy(true); setProblem("");
    try {
      const days = [...ticked].sort();
      if (byHand) {
        const r = await sb.rpc("manual_commission_pay", { p_device: partnerId, p_days: days, p_trx: trx || null, p_note: note || null });
        if (r.error) throw r.error;
      } else if (option) {
        const r = await sb.rpc("create_commission_pay", {
          p_device: partnerId, p_days: days, p_method: option.method, p_from_device: option.fromDevice, p_provider: option.provider, p_note: note || null,
        });
        if (r.error) throw r.error;
        nudgePhone(option.fromDevice);
      }
      setTicked(new Set()); setConfirming(false); onDone();
    } catch (e) {
      setProblem(errText(e)); setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  const sorted = [...rows].sort((a, b) => b.day.localeCompare(a.day));
  return (
    <div className="space-y-3 border-t border-border pt-3">
      <p className="text-sm">
        <b>{nameOf(partnerId)}</b>: commission goes to{" "}
        {number ? <span className="font-mono">{number}</span> : <span className="text-status-warn">no number saved yet (set it on this phone's card, Phones page)</span>}
        {carry > 0 ? <span className="text-muted-foreground"> · {tk(carry)} carried from earlier payments</span> : null}
      </p>

      <ul className="divide-y divide-border rounded-lg border border-border">
        {sorted.map((r) => {
          const w = DAY_WORDS[r.state] ?? DAY_WORDS.due;
          const pay = r.pay_id ? payById.get(r.pay_id) : undefined;
          const can = payable(r);
          return (
            <li key={r.day} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
              <input type="checkbox" className="h-4 w-4" disabled={!can} checked={ticked.has(r.day)} onChange={() => toggle(r.day)} aria-label={`Tick ${r.day}`} />
              <span className="w-28 shrink-0">{dayLabel(r.day)}</span>
              <span className="tabular">{tk(Number(r.commission))}</span>
              {r.state === "part" ? <span className="text-xs text-muted-foreground">{tk(Number(r.due))} still due</span> : null}
              <Badge tone={w.tone === "info" ? "info" : w.tone}>
                {r.state === "paid" ? <CheckCircle2 className="mr-1 inline h-3 w-3" aria-hidden /> : null}{w.label}
              </Badge>
              {pay ? <span className="basis-full pl-7 text-xs text-muted-foreground">{payLine(pay, nameOf)}{pay.paid_at ? ` · ${when(pay.paid_at)}` : ""}</span> : null}
            </li>
          );
        })}
        {sorted.length === 0 ? <li className="px-3 py-4 text-sm text-muted-foreground">No commission in the last two months.</li> : null}
      </ul>
      <EarlierPays pays={pays.filter((p) => p.device_id === partnerId && (p.status === "failed" || p.status === "cancelled")).slice(0, 5)} payDays={payDays} nameOf={nameOf} />

      {ticked.size ? (
        <div className="space-y-3 rounded-lg border border-primary/40 p-3">
          <p className="text-sm">
            {ticked.size} day{ticked.size === 1 ? "" : "s"}: <b>{tk(due)}</b> due{carry > 0 ? ` + ${tk(carry)} carried` : ""}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={byHand ? "outline" : "default"} onClick={() => { setByHand(false); setConfirming(false); }}>Pay from a phone</Button>
            <Button size="sm" variant={byHand ? "default" : "outline"} onClick={() => { setByHand(true); setConfirming(false); }}>Mark paid by hand</Button>
          </div>
          {!byHand ? (
            <>
              <select className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm" value={option?.key ?? ""} onChange={(e) => { setOptionKey(e.target.value); setConfirming(false); }}>
                {options.length === 0 ? <option value="">No wallet can send</option> : null}
                {options.map((o) => <option key={o.key} value={o.key} disabled={!!o.why}>{o.label}{o.why ? " (not available)" : ""}</option>)}
              </select>
              <p className="text-sm">
                Sent: <b className="text-lg tabular text-primary">{tk(split.send)}</b>
                {option?.method === "send_money" ? <span className="text-muted-foreground"> (bKash fee {tk(fee)} taken off the commission)</span> : null}
                {split.carryOut > 0 ? <span className="text-muted-foreground"> · {tk(split.carryOut)} carried to the next payment</span> : null}
              </p>
            </>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input placeholder="TrxID (optional)" value={trx} onChange={(e) => setTrx(e.target.value)} />
              <Input placeholder="Note (optional)" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          )}
          {blocked ? <p className="text-sm text-status-warn">{blocked}</p> : null}
          {problem ? <p className="rounded-lg bg-status-bad-bg p-2 text-sm text-status-bad">{problem}</p> : null}
          {!confirming ? (
            <Button disabled={!!blocked || busy} onClick={() => setConfirming(true)}>{byHand ? "Mark as paid…" : "Pay…"}</Button>
          ) : (
            <div className="space-y-2 rounded-lg border border-status-warn bg-status-warn-bg p-3 text-sm">
              <p className="flex gap-2 font-medium text-status-warn">
                <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
                {byHand
                  ? `Record ${ticked.size} day${ticked.size === 1 ? "" : "s"} of ${nameOf(partnerId)}'s commission (${tk(split.total)}) as paid.`
                  : `Send ${tk(split.send)} to ${number} by ${option!.method === "cash_in" ? "Cash In" : "Send Money"} (${option!.label}). The phone types the PIN only on the wallet screen that shows this number and this amount.`}
              </p>
              <div className="flex gap-2">
                <Button disabled={busy} onClick={() => void go()}>{busy ? "Working…" : byHand ? "Yes, mark paid" : "Yes, pay it"}</Button>
                <Button variant="outline" disabled={busy} onClick={() => setConfirming(false)}>Back</Button>
              </div>
            </div>
          )}
        </div>
      ) : null}
      <PaidByHand pays={pays.filter((p) => p.device_id === partnerId && p.method === "manual" && p.status === "paid").slice(0, 5)} nameOf={nameOf} onDone={onDone} />
    </div>
  );
}

/** A payment still going (sending) or waiting for the owner's word (unsure). */
function LivePay({ p, nameOf, onDone }: { p: CommissionPayRow; nameOf: (id: string | null | undefined) => string; onDone: () => void }) {
  const [trx, setTrx] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  async function say(sent: boolean) {
    setBusy(true);
    const r = await sb.rpc("resolve_commission_pay", { p_pay: p.id, p_sent: sent, p_trx: trx || null });
    setBusy(false);
    if (r.error) setProblem(r.error.message); else onDone();
  }
  return (
    <div className={`rounded-lg border p-3 text-sm ${p.status === "unsure" ? "border-status-warn" : "border-border"}`}>
      <p><Badge tone={p.status === "unsure" ? "bad" : "info"}>{p.status === "unsure" ? "Check the wallet" : "Sending…"}</Badge>{" "}
        <b>{nameOf(p.device_id)}</b>: {payLine(p, nameOf)} <span className="text-xs text-muted-foreground">({when(p.created_at)})</span></p>
      {p.status === "unsure" ? (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted-foreground">{UNSURE_HELP}{p.error ? ` (phone said: ${p.error})` : ""}</p>
          <div className="flex flex-wrap gap-2">
            <Input className="w-44" placeholder="TrxID, if you see it" value={trx} onChange={(e) => setTrx(e.target.value)} />
            <Button size="sm" disabled={busy} onClick={() => void say(true)}>It was sent</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void say(false)}>It was NOT sent</Button>
          </div>
          {problem ? <p className="text-xs text-status-bad">{problem}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Recent days marked paid by hand, each with an Undo in case it was a mistake. */
function PaidByHand({ pays, nameOf, onDone }: { pays: CommissionPayRow[]; nameOf: (id: string | null | undefined) => string; onDone: () => void }) {
  const [problem, setProblem] = useState("");
  if (!pays.length) return null;
  async function undo(id: string) {
    if (!window.confirm("Undo this payment marked by hand? Its days become due again.")) return;
    const r = await sb.rpc("resolve_commission_pay", { p_pay: id, p_sent: false, p_trx: null });
    if (r.error) setProblem(r.error.message); else onDone();
  }
  return (
    <div className="text-xs text-muted-foreground">
      <p className="mb-1 font-medium">Marked paid by hand</p>
      <ul className="space-y-1">
        {pays.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2">
            {payLine(p, nameOf)} · {when(p.created_at)}{p.note ? ` · ${p.note}` : ""}
            <button type="button" className="underline" onClick={() => void undo(p.id)}>Undo</button>
          </li>
        ))}
      </ul>
      {problem ? <p className="text-status-bad">{problem}</p> : null}
    </div>
  );
}

/** Payments that did not go through, so the history is never hidden. */
function EarlierPays({ pays, payDays, nameOf }: { pays: CommissionPayRow[]; payDays: PayDayRow[]; nameOf: (id: string | null | undefined) => string }) {
  if (!pays.length) return null;
  return (
    <ul className="space-y-1 text-xs text-muted-foreground">
      {pays.map((p) => {
        const days = payDays.filter((d) => d.pay_id === p.id).map((d) => dayLabel(d.day)).join(", ");
        return <li key={p.id}>{p.status === "failed" ? "Not sent" : "Undone"}: {payLine(p, nameOf)}{days ? ` · for ${days}` : ""}{p.error ? ` (${p.error})` : ""}</li>;
      })}
    </ul>
  );
}
