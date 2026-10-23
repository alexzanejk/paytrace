import { useState, type FormEvent } from "react";
import { Banknote, Download, HandCoins, Percent, Wallet } from "lucide-react";
import { must, sb } from "@/lib/supabase";
import { tk } from "@/lib/format";
import { PROVIDER_LABEL } from "@/lib/types";
import { dayLabel, dhakaDay, periodRange, rangeLabel } from "@/lib/period";
import { downloadText, toCsv } from "@/lib/csv";
import { KIND_LABEL, fmtPct, owedOf, sumDays, type CommissionBalance, type CommissionDay, type Payout } from "@/lib/commission";
import { useDevices } from "@/hooks/useDevices";
import { useQuery } from "@/hooks/useQuery";
import { Screen } from "@/components/Screen";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { DeviceChip } from "@/components/DeviceChip";
import { ProviderChip } from "@/components/ProviderChip";
import { PeriodPicker, initialPeriod, type PeriodState } from "@/components/PeriodPicker";
import { ALL, FilterSelect } from "@/components/FilterSelect";
import { Confirm } from "@/components/Confirm";
import { EmptyRow } from "@/components/Empty";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** What each partner phone earned, what was paid to them, and what is still owed. PayTrace only records this: the owner pays
 *  partners outside the system and records it here. */
export function Commission() {
  const devices = useDevices();
  const [period, setPeriod] = useState<PeriodState>(() => ({ ...initialPeriod(), id: "7d" }));
  const [device, setDevice] = useState(ALL);
  const range = periodRange(period.id, period.custom);

  const { data, error, loading, refresh } = useQuery(
    async () => {
      let q = sb.from("device_commission_daily").select("*").gte("day", range.from).lte("day", range.to).order("day", { ascending: false }).limit(5000);
      if (device !== ALL) q = q.eq("device_id", device);
      const days = must(await q) as CommissionDay[];
      const balances = must(await sb.from("device_commission_balance").select("*")) as CommissionBalance[];
      const payouts = must(await sb.from("commission_payouts").select("*").order("paid_on", { ascending: false }).order("created_at", { ascending: false }).limit(200)) as Payout[];
      return { days, balances, payouts };
    },
    [device, range.from, range.to],
    { refreshMs: 20000 },
  );

  const days = data?.days ?? [];
  const balances = data?.balances ?? [];
  const payouts = (data?.payouts ?? []).filter((p) => device === ALL || p.device_id === device);
  const inRange = sumDays(days);
  const balanceRows = balances.filter((b) => device === ALL || b.device_id === device);
  const owedTotal = balanceRows.reduce((s, b) => s + owedOf(b.earned, b.paid).owed, 0);
  const paidTotal = balanceRows.reduce((s, b) => s + Number(b.paid), 0);
  const approved = devices.list.filter((d) => d.status === "approved");
  const phoneOptions = approved.map((d) => ({ value: d.id, label: devices.nameOf(d.id) }));

  function exportCsv() {
    const csv = toCsv(
      ["Day", "Phone", "Provider", "Kind", "Payments", "Day total (Tk)", "Rate %", "Commission (Tk)"],
      days.map((r) => [r.day, devices.nameOf(r.device_id), PROVIDER_LABEL[r.provider] ?? r.provider, KIND_LABEL[r.kind], r.n, r.total, r.rate_pct ?? "", r.commission]),
    );
    downloadText(`paytrace-commission-${range.from}_${range.to}.csv`, csv);
  }

  return (
    <Screen loading={loading || devices.loading} error={error ?? devices.error} hasData={!!data}>
      <PageHeader
        title="Commission"
        description={`What partners earn on the money that comes through their phones. Showing ${rangeLabel(range)} (days run 12:00 AM to 11:59 PM Bangladesh time). Set each phone's rates on the Phones page. PayTrace only records this: you pay partners yourself and record it below.`}
        actions={
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={days.length === 0}>
            <Download aria-hidden /> Download CSV
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <PeriodPicker value={period} onChange={setPeriod} />
        <FilterSelect label="All partner phones" value={device} onChange={setDevice} options={phoneOptions} className="w-56" />
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total received" value={tk(inRange.total)} sub={`${inRange.n} payments in this period`} icon={Wallet} />
        <StatCard label="Commission earned" value={tk(inRange.commission)} sub="in this period" icon={Percent} />
        <StatCard label="Paid so far" value={tk(paidTotal)} sub="all time" icon={HandCoins} />
        <StatCard label="Still owed" value={tk(owedTotal)} sub="all time, earned minus paid" icon={Banknote} />
      </div>

      <h3 className="mb-2 text-base font-semibold">Each partner</h3>
      <Card className="mb-6 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Phone</TableHead>
              <TableHead className="text-right">Earned (all time)</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Still owed</TableHead>
              <TableHead>App</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {approved.filter((d) => device === ALL || d.id === device).length === 0 ? (
              <EmptyRow cols={5} text="No approved phone yet." />
            ) : (
              approved
                .filter((d) => device === ALL || d.id === device)
                .map((d) => {
                  const b = balances.find((x) => x.device_id === d.id);
                  const { owed, over } = owedOf(b?.earned ?? 0, b?.paid ?? 0);
                  return (
                    <TableRow key={d.id}>
                      <TableCell><DeviceChip id={d.id} name={devices.nameOf(d.id)} /></TableCell>
                      <TableCell className="text-right tabular">{tk(b?.earned ?? 0)}</TableCell>
                      <TableCell className="text-right tabular">{tk(b?.paid ?? 0)}</TableCell>
                      <TableCell className="text-right tabular">
                        {over > 0 ? <span className="text-status-warn">Overpaid {tk(over)}</span> : tk(owed)}
                      </TableCell>
                      <TableCell>{d.show_earnings ? <Badge tone="ok">Shows earnings</Badge> : <Badge tone="idle">Hidden</Badge>}</TableCell>
                    </TableRow>
                  );
                })
            )}
          </TableBody>
        </Table>
      </Card>

      <h3 className="mb-2 text-base font-semibold">Day by day</h3>
      <Card className="mb-6 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Day</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead className="text-right">Day total</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">Commission</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {days.length === 0 ? (
              <EmptyRow cols={7} text="No Cash Out or Send Money payments in this period." />
            ) : (
              days.map((r) => (
                <TableRow key={`${r.day}|${r.device_id}|${r.provider}|${r.kind}`}>
                  <TableCell className="whitespace-nowrap">{dayLabel(r.day)}</TableCell>
                  <TableCell><DeviceChip id={r.device_id} name={devices.nameOf(r.device_id)} /></TableCell>
                  <TableCell><ProviderChip provider={r.provider} /></TableCell>
                  <TableCell>{KIND_LABEL[r.kind]}</TableCell>
                  <TableCell className="text-right tabular">{tk(r.total)}<span className="block text-xs text-muted-foreground">{r.n} payment{r.n === 1 ? "" : "s"}</span></TableCell>
                  <TableCell className="text-right tabular">{r.rate_pct == null ? <span className="text-status-warn">No rate</span> : fmtPct(Number(r.rate_pct))}</TableCell>
                  <TableCell className="text-right tabular">{tk(r.commission)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <PayoutsSection devices={approved.map((d) => ({ id: d.id, name: devices.nameOf(d.id) }))} nameOf={devices.nameOf} payouts={payouts} onChanged={refresh} />
    </Screen>
  );
}

function PayoutsSection({
  devices,
  nameOf,
  payouts,
  onChanged,
}: {
  devices: { id: string; name: string }[];
  nameOf: (id: string | null | undefined) => string;
  payouts: Payout[];
  onChanged: () => void;
}) {
  const [who, setWho] = useState("");
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(dhakaDay());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  async function add(e: FormEvent) {
    e.preventDefault();
    setProblem("");
    setBusy(true);
    const { error } = await sb.rpc("add_commission_payout", { p_device: who, p_amount: Number(amount), p_paid_on: paidOn, p_note: note });
    setBusy(false);
    if (error) return setProblem(error.message);
    setAmount("");
    setNote("");
    onChanged();
  }

  async function voidOne(id: string) {
    const { error } = await sb.rpc("void_commission_payout", { p_id: id });
    if (error) return setProblem(error.message);
    onChanged();
  }

  const amountOk = /^\d{1,9}(\.\d{1,2})?$/.test(amount.trim()) && Number(amount) > 0;

  return (
    <section className="grid gap-3">
      <h3 className="text-base font-semibold">Payouts you made</h3>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Pay the partner yourself (bKash, Nagad, bank, cash), then record it here so the balance shows what is still owed. A wrong entry is voided, never removed, so the history stays complete.
      </p>
      <Card className="p-4">
        <form onSubmit={add} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_10rem] lg:grid-cols-[minmax(0,1fr)_9rem_10rem_minmax(0,1.2fr)_auto]">
          <Select value={who} onValueChange={setWho}>
            <SelectTrigger aria-label="Which partner was paid"><SelectValue placeholder="Which partner?" /></SelectTrigger>
            <SelectContent>
              {devices.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount (Tk)" aria-label="Amount paid in taka" />
          <Input type="date" value={paidOn} max={dhakaDay()} onChange={(e) => setPaidOn(e.target.value || dhakaDay())} aria-label="Date paid" />
          <Input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Note, e.g. bKash TrxID" aria-label="Note" className="sm:col-span-3 lg:col-span-1" />
          <Button type="submit" disabled={busy || !who || !amountOk}>{busy ? "Saving…" : "Record payout"}</Button>
        </form>
        {problem ? <p className="mt-2 text-sm text-destructive">{problem}</p> : null}
      </Card>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Paid on</TableHead>
              <TableHead>Partner</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Note</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {payouts.length === 0 ? (
              <EmptyRow cols={5} text="No payout recorded yet." />
            ) : (
              payouts.map((p) => (
                <TableRow key={p.id} className={p.voided_at ? "text-muted-foreground line-through" : undefined}>
                  <TableCell className="whitespace-nowrap">{dayLabel(p.paid_on)}</TableCell>
                  <TableCell><DeviceChip id={p.device_id} name={nameOf(p.device_id)} /></TableCell>
                  <TableCell className="text-right tabular">{tk(p.amount)}</TableCell>
                  <TableCell className="max-w-64 truncate" title={p.note ?? ""}>{p.note ?? ""}</TableCell>
                  <TableCell className="text-right">
                    {p.voided_at ? (
                      <Badge tone="idle">Voided</Badge>
                    ) : (
                      <Confirm
                        title="Void this payout?"
                        description="It stops counting as paid, so the partner's balance owed goes up by this amount. The entry stays in the history, marked voided."
                        confirmLabel="Void it"
                        onConfirm={() => voidOne(p.id)}
                      >
                        <Button size="sm" variant="outline">Void</Button>
                      </Confirm>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </section>
  );
}
