import { AppSearch } from "@/components/AppSearch";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, HandCoins, Search, TriangleAlert } from "lucide-react";
import { must, sb } from "@/lib/supabase";
import { tk, when } from "@/lib/format";
import { PROVIDERS, PROVIDER_LABEL, type Payment } from "@/lib/types";
import { rangeBounds, rangeLabel, periodRange } from "@/lib/period";
import {
  PAYOUT_WORDS, UNSURE_HELP, checkNumbers, groupDigits, liveItemsByPayment, parsePct, parseSendAmount, keepPctFor, payoutLine, payoutRefusal, recentNumbers,
  parseFee, sendMethod, sendProblem, senderOptions, splitPayout, ROCKET_NOTE, METHOD_WORDS, type PayoutItemRow, type PayoutRow,
} from "@/lib/payouts";
import { nudgePhone } from "@/lib/wake";
import { useQuery } from "@/hooks/useQuery";
import { useDevices } from "@/hooks/useDevices";
import { Screen } from "@/components/Screen";
import { PageHeader } from "@/components/PageHeader";
import { StatCard, STAT_GRID } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { DeviceChip } from "@/components/DeviceChip";
import { ProviderChip } from "@/components/ProviderChip";
import { FilterSelect, ALL } from "@/components/FilterSelect";
import { PeriodPicker, initialPeriod, type PeriodState } from "@/components/PeriodPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SendWayChoice } from "@/components/SendWayChoice";
import { type SendWay, wayWords } from "@/lib/sendWay";

/** Only money RECEIVED can be paid out (the database's payout_refusal says the same). */
const PAYABLE_TYPES = ["cash_out", "send_money_received", "payment_received"];
const PAGE = 200;
const safeSearch = (q: string) => q.replace(/[^A-Za-z0-9*+\-]/g, "").slice(0, 40);

type Show = "open" | "paid" | "all";

/** The Payout page (owner 2026-11-08): the same transactions as the Transactions page, but each can be ticked and paid on.
 *  Tick one or several, keep a share (20% unless changed), and send the rest in whole taka to a number you type twice.
 *  An agent wallet sends it by Cash In through its phone, a personal bKash account by Send Money. A transaction is in at most one live payout, enforced by the
 *  database, so nothing can be paid twice. */
export function Payouts() {
  const devices = useDevices();
  const [period, setPeriod] = useState<PeriodState>(() => initialPeriod());
  const [device, setDevice] = useState(ALL);
  const [provider, setProvider] = useState(ALL);
  const [show, setShow] = useState<Show>("open");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setTerm(safeSearch(search)), 300);
    return () => clearTimeout(id);
  }, [search]);
  useEffect(() => setLimit(PAGE), [device, provider, period, term]);

  const range = periodRange(period.id, period.custom);
  const { startIso, endIso } = rangeBounds(range);

  const { data, error, loading, refresh: reload } = useQuery(
    async () => {
      let q = sb
        .from("payments")
        .select("*", { count: "exact" })
        .eq("source", "app")
        .in("txn_type", PAYABLE_TYPES)
        .or(
          `and(occurred_at.gte.${startIso},occurred_at.lt.${endIso}),and(occurred_at.is.null,received_at.gte.${startIso},received_at.lt.${endIso})`,
        )
        .order("received_at", { ascending: false })
        .limit(limit);
      if (device !== ALL) q = q.eq("device_id", device);
      if (provider !== ALL) q = q.eq("provider", provider);
      if (term) q = q.or(`trx_id.ilike.%${term}%,counterparty.ilike.%${term}%`);
      const res = await q;
      if (res.error) throw new Error(res.error.message);
      const rows = (res.data ?? []) as Payment[];
      const ids = rows.map((r) => r.id);
      const items = ids.length
        ? (must(await sb.from("payout_items").select("payout_id,payment_id,amount,live").in("payment_id", ids)) as PayoutItemRow[])
        : [];
      const recent = must(await sb.from("payouts").select("*").order("created_at", { ascending: false }).limit(300)) as PayoutRow[];
      const known = new Set(recent.map((p) => p.id));
      const missing = [...new Set(items.map((i) => i.payout_id))].filter((id) => !known.has(id));
      const older = missing.length ? (must(await sb.from("payouts").select("*").in("id", missing)) as PayoutRow[]) : [];
      const settings = must(await sb.from("payout_settings").select("keep_pct,send_money_fee").limit(1)) as { keep_pct: number | string; send_money_fee?: number | string }[];
      return {
        rows, total: res.count ?? 0, items, payouts: [...recent, ...older],
        keepPct: Number(settings[0]?.keep_pct ?? 20), sendFee: Number(settings[0]?.send_money_fee ?? 10),
      };
    },
    [device, provider, startIso, endIso, term, limit],
    { refreshMs: 10000 },
  );

  const rows = data?.rows ?? [];
  const payoutsById = useMemo(() => new Map((data?.payouts ?? []).map((p) => [p.id, p])), [data]);
  const liveOf = useMemo(() => liveItemsByPayment(data?.items ?? []), [data]);
  const taken = useMemo(() => new Set(liveOf.keys()), [liveOf]);
  const shown = rows.filter((p) => (show === "all" ? true : show === "paid" ? taken.has(p.id) : !taken.has(p.id)));

  // Drop ticks on rows that are gone or became unpayable (another tab paid them, a payout started).
  useEffect(() => {
    setTicked((t) => {
      const ok = new Set([...t].filter((id) => rows.some((r) => r.id === id && !payoutRefusal(r, taken))));
      return ok.size === t.size ? t : ok;
    });
  }, [rows, taken]);

  const chosen = rows.filter((r) => ticked.has(r.id));
  const sending = (data?.payouts ?? []).filter((p) => p.status === "sending" || p.status === "unsure");
  const openSum = rows.filter((r) => !taken.has(r.id) && !payoutRefusal(r, taken)).reduce((s, r) => s + Number(r.amount), 0);
  const paidSum = rows.filter((r) => taken.has(r.id)).reduce((s, r) => s + Number(r.amount), 0);

  function toggle(id: string) {
    setTicked((t) => {
      const n = new Set(t);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  const tickable = shown.filter((r) => !payoutRefusal(r, taken));
  const allTicked = tickable.length > 0 && tickable.every((r) => ticked.has(r.id));

  const phoneOptions = devices.list.filter((d) => d.status === "approved").map((d) => ({ value: d.id, label: devices.nameOf(d.id) }));

  return (
    <Screen loading={loading || devices.loading} error={error ?? devices.error} hasData={!!data}>
      <PageHeader
        title="Payout"
        description={`Pay on received money: keep your share and send the rest. Showing ${rangeLabel(range)} (Bangladesh days).`}
      />

      <AppSearch />

      {sending.length ? (
        <div className="mb-4 space-y-2">
          {sending.map((p) => <LivePayout key={p.id} p={p} nameOf={devices.nameOf} onDone={reload} />)}
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <PeriodPicker value={period} onChange={setPeriod} />
        <FilterSelect label="All phones" value={device} onChange={setDevice} options={phoneOptions} className="w-[calc(50%-0.25rem)] sm:w-48" />
        <FilterSelect label="All gateways" value={provider} onChange={setProvider} options={PROVIDERS.map((p) => ({ value: p, label: PROVIDER_LABEL[p] }))} />
        <div className="flex rounded-lg border border-input p-0.5 text-sm" role="group" aria-label="Which transactions">
          {(["open", "paid", "all"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setShow(s)}
              className={`rounded-md px-3 py-1.5 ${show === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
              aria-pressed={show === s}
            >
              {s === "open" ? "Not paid out" : s === "paid" ? "Paid out" : "All"}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input className="pl-9" placeholder="Search TrxID or number" aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className={`mb-5 ${STAT_GRID}`}>
        <StatCard label="Not paid out yet" value={tk(openSum)} sub="received money in this list that can be paid on" />
        <StatCard label="Paid out" value={tk(paidSum)} sub="in this list, already in a payout" />
        <StatCard label="Ticked" value={tk(chosen.reduce((s, r) => s + Number(r.amount), 0))} sub={`${chosen.length} transaction${chosen.length === 1 ? "" : "s"}`} />
        <StatCard label="Your share" value={`${data?.keepPct ?? 20}%`} sub="kept by default; change it per payout below" />
      </div>

      {chosen.length ? (
        <PayoutPanel
          key={[...ticked].sort().join(",")}
          chosen={chosen}
          defaultPct={data?.keepPct ?? 20}
          defaultFee={data?.sendFee ?? 10}
          devices={devices.list}
          nameOf={devices.nameOf}
          recent={recentNumbers(data?.payouts ?? [])}
          onDone={() => { setTicked(new Set()); reload(); }}
          onClear={() => setTicked(new Set())}
        />
      ) : null}

      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 border-b border-border px-4 py-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[var(--color-primary)]"
            aria-label="Tick every transaction that can be paid out"
            checked={allTicked}
            disabled={!tickable.length}
            onChange={() => setTicked(allTicked ? new Set() : new Set(tickable.slice(0, 200).map((r) => r.id)))}
          />
          <span>{shown.length} transaction{shown.length === 1 ? "" : "s"}</span>
        </div>
        {shown.length === 0 ? <p className="py-8 text-center text-muted-foreground">No transactions here.</p> : null}
        <ul className="divide-y divide-border">
          {shown.map((p) => {
            const why = payoutRefusal(p, taken);
            const payout = liveOf.has(p.id) ? payoutsById.get(liveOf.get(p.id)!) : undefined;
            const isOpen = open === p.id;
            return (
              <li key={p.id} className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-[var(--color-primary)]"
                    aria-label={`Tick ${p.trx_id}`}
                    checked={ticked.has(p.id)}
                    disabled={!!why}
                    title={why ?? "Tick to pay this out"}
                    onChange={() => toggle(p.id)}
                  />
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(isOpen ? null : p.id)} aria-expanded={isOpen}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />}
                        <ProviderChip provider={p.provider} />
                        <span className="font-mono text-xs">{p.trx_id}</span>
                      </div>
                      <span className="text-base font-semibold tabular">{tk(p.amount)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <DeviceChip id={p.device_id} name={devices.nameOf(p.device_id)} />
                      <span>{when(p.occurred_at ?? p.received_at)}</span>
                      <StatusBadge status={p.status} />
                      {payout ? (
                        <Badge tone={PAYOUT_WORDS[payout.status].tone}>
                          {payout.status === "paid" ? <CheckCircle2 className="mr-1 inline h-3 w-3" aria-hidden /> : null}
                          {PAYOUT_WORDS[payout.status].label}
                        </Badge>
                      ) : why && why !== "Already paid out" ? <span className="text-status-warn">{why}</span> : null}
                    </div>
                  </button>
                </div>
                {isOpen ? (
                  <div className="ml-7 mt-3 space-y-2 border-t border-border pt-3 text-sm">
                    {payout ? <PayoutDetails p={payout} nameOf={devices.nameOf} onDone={reload} /> : <p className="text-muted-foreground">Not paid out yet.</p>}
                    <OldPayouts paymentId={p.id} items={data?.items ?? []} byId={payoutsById} nameOf={devices.nameOf} />
                    <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">{p.raw_message}</pre>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>Loaded {rows.length} of {data?.total ?? 0} received transactions</span>
        {rows.length < (data?.total ?? 0) ? (
          <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE)}>Load more</Button>
        ) : null}
      </div>
    </Screen>
  );
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)).replace(/^send_money_not_ready: /, "");

/** The panel that appears once something is ticked: the split, the sender, the number (typed twice), and the confirm. */
function PayoutPanel({
  chosen, defaultPct, defaultFee, devices, nameOf, recent, onDone, onClear,
}: {
  chosen: Payment[];
  defaultPct: number;
  defaultFee: number;
  devices: ReturnType<typeof useDevices>["list"];
  nameOf: (id: string | null | undefined) => string;
  recent: string[];
  onDone: () => void;
  onClear: () => void;
}) {
  const [pctText, setPctText] = useState(String(defaultPct));
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [note, setNote] = useState("");
  const [byHand, setByHand] = useState(false);
  const [trx, setTrx] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [saveDefault, setSaveDefault] = useState(false);
  const [feeText, setFeeText] = useState(String(defaultFee));
  // Either box can be typed in (owner 2026-11-09): the one typed last decides, the other follows.
  const [driver, setDriver] = useState<"pct" | "send">("pct");
  const [sendText, setSendText] = useState("");

  const total = chosen.reduce((s, r) => s + Number(r.amount), 0);
  const options = useMemo(() => senderOptions(devices.map((d) => ({ id: d.id, name: nameOf(d.id), status: d.status, allow_cashin: d.allow_cashin, allow_personal: d.allow_personal, info: d.info }))), [devices, nameOf]);
  // The wallet that received the money sends it on, when it can.
  const first0 = chosen[0];
  const preferred = options.find((o) => !o.why && o.deviceId === first0?.device_id && o.provider === first0?.provider && o.account === "agent")
    ?? options.find((o) => !o.why && o.provider === first0?.provider) ?? options.find((o) => !o.why);
  const [senderKey, setSenderKey] = useState(preferred?.key ?? "");
  const sender = options.find((o) => o.key === senderKey);
  // USSD or the bKash app (owner 2026-11-10); the app only for a bKash agent Cash In from a phone that can do it.
  const [way, setWay] = useState<SendWay>("ussd");
  // A personal Send Money costs the sender a bKash fee; it comes off what is sent, never off your share (owner 2026-11-08).
  const personal = !byHand && sender?.account === "personal";
  const fee = personal ? parseFee(feeText) : 0;
  const typedSend = driver === "send" ? parseSendAmount(sendText) : null;
  const pct = driver === "pct" ? parsePct(pctText) : typedSend == null || fee == null ? null : keepPctFor(total, typedSend, fee);
  const split = pct == null || fee == null ? null : splitPayout(total, pct, fee);
  const most = fee == null ? 0 : Math.max(0, Math.floor(total - fee));
  const shownPct = driver === "pct" ? pctText : pct == null ? "" : String(Math.round(pct * 100) / 100);
  const shownSend = driver === "send" ? sendText : split ? String(split.send) : "";

  const nums = checkNumbers(first, second);
  const sizeProblem = split ? sendProblem(split.send, byHand ? "manual" : "cash_in") : "";
  const mixed = new Set(chosen.map((r) => `${r.device_id}:${r.provider}`)).size > 1;

  const ready = !!split && !sizeProblem && (byHand ? (first.trim() ? !!nums.number : true) : !!nums.number && !!sender && !sender.why);
  const blockedBy = fee == null ? "Type the bKash fee to set aside (0 to 500 taka)."
    : driver === "send" && typedSend == null ? "Type the amount to send in whole taka."
    : driver === "send" && pct == null ? `You can send at most ${tk(most)} from these transactions${fee ? " after the fee" : ""}.`
    : pct == null ? "Type the share you keep (0 to 100)." : fee == null ? "Type the bKash fee to set aside (0 to 500 taka)." : !split ? "" : sizeProblem
    || (byHand ? (first.trim() && !nums.number ? nums.problem : "") : !sender ? "Choose the wallet that sends it." : sender.why || nums.problem);

  async function go() {
    if (!split || pct == null) return;
    setBusy(true); setProblem("");
    try {
      if (saveDefault && driver === "pct" && pct !== defaultPct) {
        const r = await sb.rpc("set_payout_settings", { p_keep_pct: pct });
        if (r.error) throw r.error;
      }
      // The database takes the fee from its own setting, so a changed fee is saved first, then used.
      if (personal && fee != null && fee !== defaultFee) {
        const r = await sb.rpc("set_payout_send_fee", { p_fee: fee });
        if (r.error) throw r.error;
      }
      if (byHand) {
        const r = await sb.rpc("manual_payout", {
          p_payments: chosen.map((r) => r.id), p_keep_pct: pct, p_to_number: nums.number ?? null, p_trx: trx || null, p_note: note || null,
        });
        if (r.error) throw r.error;
      } else if (sender) {
        const r = await sb.rpc("create_payout_via", {
          p_payments: chosen.map((r) => r.id), p_device: sender.deviceId, p_provider: sender.provider, p_to_number: nums.number,
          p_keep_pct: pct, p_from_account: sender.account, p_note: note || null, p_via: way,
        });
        if (r.error) throw r.error;
        nudgePhone(sender.deviceId);
      }
      onDone();
    } catch (e) {
      setProblem(errText(e));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-5 space-y-4 border-primary/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold"><HandCoins className="mr-1 inline h-4 w-4" aria-hidden /> Pay out {chosen.length} transaction{chosen.length === 1 ? "" : "s"}: {tk(total)}</h2>
        <Button variant="ghost" size="sm" onClick={onClear}>Clear ticks</Button>
      </div>
      {mixed ? <p className="text-xs text-muted-foreground">These came in on more than one wallet; they are paid out together from the one wallet you choose below.</p> : null}

      <div className="grid gap-4 md:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">You keep (%)</span>
          <Input
            inputMode="decimal" value={shownPct} aria-label="Share you keep, percent"
            onChange={(e) => { setDriver("pct"); setPctText(e.target.value); setConfirming(false); }}
          />
          {driver === "pct" ? (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={saveDefault} onChange={(e) => setSaveDefault(e.target.checked)} /> make this the default
            </span>
          ) : (
            <span className="block text-xs text-muted-foreground">Worked out from the amount you typed.</span>
          )}
        </label>
        <div className="space-y-1 text-sm">
          <span className="text-muted-foreground">Kept</span>
          <p className="text-lg font-semibold tabular">{split ? tk(split.keep) : "–"}</p>
        </div>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Sent (whole taka)</span>
          <Input
            className="text-lg font-bold tabular text-primary" inputMode="numeric" value={shownSend} aria-label="Amount to send, taka"
            onChange={(e) => { setDriver("send"); setSendText(e.target.value); setConfirming(false); }}
          />
          <span className="block text-xs text-muted-foreground">Type an amount and the share you keep follows. At most {tk(most)}.</span>
        </label>
      </div>
      {personal ? (
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">bKash Send Money fee, taken off what is sent (not off your share)</span>
          <Input className="w-40" inputMode="decimal" value={feeText} onChange={(e) => { setFeeText(e.target.value); setConfirming(false); }} aria-label="bKash fee to set aside, taka" />
          <span className="block text-xs text-muted-foreground">
            bKash only says the real fee after sending (free to your Priyo numbers up to their monthly total, Tk 5 or Tk 10 otherwise;
            Tk 10 on Tk 850 in your recording). This much is set aside; the real fee from bKash's receipt is shown on the payout
            afterwards. A changed figure becomes the new default.
          </span>
        </label>
      ) : null}

      <div className="flex flex-wrap gap-2 text-sm" role="group" aria-label="How it is paid">
        <Button variant={byHand ? "outline" : "default"} size="sm" onClick={() => { setByHand(false); setConfirming(false); }}>Send from a phone</Button>
        <Button variant={byHand ? "default" : "outline"} size="sm" onClick={() => { setByHand(true); setConfirming(false); }}>Mark paid by hand</Button>
      </div>

      {!byHand ? (
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">Send from</span>
          <select
            className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
            value={senderKey}
            onChange={(e) => { setSenderKey(e.target.value); setConfirming(false); }}
          >
            <option value="">Choose a wallet…</option>
            {options.map((o) => (
              <option key={o.key} value={o.key} disabled={!!o.why}>{o.label}{o.why ? " (not available)" : ""}</option>
            ))}
          </select>
          {sender?.why ? <span className="text-xs text-status-warn">{sender.why}</span> : null}
          {sender?.provider === "rocket" && !sender.why ? <span className="text-xs text-status-warn">{ROCKET_NOTE}</span> : null}
          {!options.length ? <span className="text-xs text-status-warn">No phone has a bKash or Nagad account saved in its app yet.</span> : null}
          {sender && !sender.why ? (
            <SendWayChoice deviceId={sender.deviceId} provider={sender.provider} account={sender.account} value={way} onChange={(w) => { setWay(w); setConfirming(false); }} />
          ) : null}
          <span className="block text-xs text-muted-foreground">An agent wallet sends it by Cash In (no daily limit). A personal bKash account sends it by Send Money (it keeps the daily limit set on the Jobs page, and bKash charges its Send Money fee). One send is Tk 100 to Tk 50,000.</span>
        </label>
      ) : (
        <p className="text-xs text-muted-foreground">Use this when you paid outside PayTrace. The transactions are marked paid at once. Number and TrxID are optional but help later.</p>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Number to send to {byHand ? "(optional)" : ""}</span>
          <Input inputMode="tel" autoComplete="off" placeholder="01XXXXXXXXX" value={first} onChange={(e) => { setFirst(e.target.value); setConfirming(false); }} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Type it again</span>
          <Input
            inputMode="tel" autoComplete="off" placeholder="01XXXXXXXXX" value={second}
            onPaste={(e) => e.preventDefault()}
            onChange={(e) => { setSecond(e.target.value); setConfirming(false); }}
            aria-describedby="payout-twice"
          />
          <span id="payout-twice" className="text-xs text-muted-foreground">Typed, not pasted, so a wrong paste is caught.</span>
        </label>
      </div>
      {recent.length ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Paid before:</span>
          {recent.map((n) => (
            <button key={n} type="button" className="rounded-full border border-input px-2.5 py-1 font-mono hover:bg-muted" onClick={() => { setFirst(n); setSecond(n); setConfirming(false); }}>
              {groupDigits(n)}
            </button>
          ))}
        </div>
      ) : null}

      {byHand ? (
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">TrxID of your payment (optional)</span>
          <Input value={trx} onChange={(e) => setTrx(e.target.value)} autoComplete="off" />
        </label>
      ) : null}
      <label className="block space-y-1 text-sm">
        <span className="text-muted-foreground">Note (optional)</span>
        <Input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      </label>

      {nums.number ? <p className="font-mono text-3xl font-bold tracking-wider" aria-label="Number read back">{groupDigits(nums.number)}</p> : null}

      {blockedBy && (first || second || byHand || !sender) ? <p className="text-sm text-status-warn">{blockedBy}</p> : null}
      {problem ? <p className="rounded-lg bg-status-bad-bg p-3 text-sm text-status-bad">{problem}</p> : null}

      {!confirming ? (
        <Button disabled={!ready || busy} onClick={() => setConfirming(true)}>{byHand ? "Mark as paid…" : "Send…"}</Button>
      ) : (
        <div className="space-y-3 rounded-lg border border-status-warn bg-status-warn-bg p-3 text-sm">
          <p className="flex gap-2 font-medium text-status-warn">
            <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
            {byHand
              ? `Record that you paid ${tk(split!.send)}${nums.number ? ` to ${groupDigits(nums.number)}` : ""} and kept ${tk(split!.keep)}. The ${chosen.length} transaction${chosen.length === 1 ? "" : "s"} will show Paid.`
              : `Send ${tk(split!.send)} by ${METHOD_WORDS[sendMethod(sender!.account)]} to ${groupDigits(nums.number!)} from ${sender!.label}, ${wayWords(way)}.${split!.fee ? ` ${tk(split!.fee)} is set aside for the bKash fee.` : ""} You keep ${tk(split!.keep)}. ${way === "app" ? "The phone sends only when the bKash app shows this number and this amount." : "The phone types the PIN only on the wallet screen that shows this number and this amount."}`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void go()}>{busy ? "Working…" : byHand ? "Yes, mark paid" : "Yes, send it"}</Button>
            <Button variant="outline" disabled={busy} onClick={() => setConfirming(false)}>Back</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/** A payout still under way (sending) or waiting for the owner's word (unsure), shown above the list. */
function LivePayout({ p, nameOf, onDone }: { p: PayoutRow; nameOf: (id: string | null | undefined) => string; onDone: () => void }) {
  const w = PAYOUT_WORDS[p.status];
  return (
    <Card className={`p-3 text-sm ${p.status === "unsure" ? "border-status-warn" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={w.tone}>{w.label}</Badge>
        <span>{payoutLine(p, nameOf)}</span>
        <span className="text-xs text-muted-foreground">started {when(p.created_at)}</span>
      </div>
      {p.status === "unsure" ? <UnsureControls p={p} onDone={onDone} /> : null}
    </Card>
  );
}

function UnsureControls({ p, onDone }: { p: PayoutRow; onDone: () => void }) {
  const [trx, setTrx] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  async function say(sent: boolean) {
    setBusy(true); setProblem("");
    const r = await sb.rpc("resolve_payout", { p_payout: p.id, p_sent: sent, p_trx: trx || null });
    setBusy(false);
    if (r.error) setProblem(r.error.message); else onDone();
  }
  return (
    <div className="mt-2 space-y-2">
      <p className="text-xs text-muted-foreground">{UNSURE_HELP}{p.error ? ` (phone said: ${p.error})` : ""}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="w-44" placeholder="TrxID, if you see it" value={trx} onChange={(e) => setTrx(e.target.value)} />
        <Button size="sm" disabled={busy} onClick={() => void say(true)}>It was sent</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void say(false)}>It was NOT sent</Button>
      </div>
      {problem ? <p className="text-xs text-status-bad">{problem}</p> : null}
    </div>
  );
}

function PayoutDetails({ p, nameOf, onDone }: { p: PayoutRow; nameOf: (id: string | null | undefined) => string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  async function undo() {
    if (!window.confirm("Undo this payout recorded by hand? The transactions become payable again.")) return;
    setBusy(true);
    const r = await sb.rpc("resolve_payout", { p_payout: p.id, p_sent: false, p_trx: null });
    setBusy(false);
    if (r.error) setProblem(r.error.message); else onDone();
  }
  return (
    <div className="space-y-1">
      <p><Badge tone={PAYOUT_WORDS[p.status].tone}>{PAYOUT_WORDS[p.status].label}</Badge> <span className="ml-1">{payoutLine(p, nameOf)}</span></p>
      <p className="text-xs text-muted-foreground">
        Started {when(p.created_at)}{p.paid_at ? ` · paid ${when(p.paid_at)}` : ""}{p.balance_after != null ? ` · wallet balance after ${tk(Number(p.balance_after))}` : ""}{p.note ? ` · note: ${p.note}` : ""}
      </p>
      {p.status === "unsure" ? <UnsureControls p={p} onDone={onDone} /> : null}
      {p.status === "paid" && p.method === "manual" ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void undo()}>Undo (it was not paid)</Button> : null}
      {problem ? <p className="text-xs text-status-bad">{problem}</p> : null}
    </div>
  );
}

/** Earlier tries for this transaction that did not go through (failed or undone), so the history is never hidden. */
function OldPayouts({ paymentId, items, byId, nameOf }: { paymentId: string; items: PayoutItemRow[]; byId: Map<string, PayoutRow>; nameOf: (id: string | null | undefined) => string }) {
  const old = items.filter((i) => i.payment_id === paymentId && !i.live).map((i) => byId.get(i.payout_id)).filter((p): p is PayoutRow => !!p);
  if (!old.length) return null;
  return (
    <ul className="space-y-1 text-xs text-muted-foreground">
      {old.map((p) => <li key={p.id}>{PAYOUT_WORDS[p.status].label}: {payoutLine(p, nameOf)} ({when(p.created_at)}){p.error ? `, ${p.error}` : ""}</li>)}
    </ul>
  );
}
