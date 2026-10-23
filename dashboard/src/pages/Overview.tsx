import { useState } from "react";
import { ArrowDownToLine, Banknote, Clock, HandCoins, Scale } from "lucide-react";
import { must, sb } from "@/lib/supabase";
import { tk, when } from "@/lib/format";
import { PROVIDERS, PROVIDER_LABEL, TYPE_LABEL, type DeviceBalance, type ProviderBalance } from "@/lib/types";
import { dayLabel, groupSummary, isCounted, periodRange, rangeLabel, summarize, type DayTotal } from "@/lib/period";
import { openPaymentsWith } from "@/lib/filters";
import { useQuery } from "@/hooks/useQuery";
import { useDevices } from "@/hooks/useDevices";
import { Screen } from "@/components/Screen";
import { PageHeader } from "@/components/PageHeader";
import { StatCard, STAT_GRID } from "@/components/StatCard";
import { DeviceChip } from "@/components/DeviceChip";
import { ProviderChip } from "@/components/ProviderChip";
import { DeviceHealthBadge } from "@/components/DeviceHealthBadge";
import { FilterSelect, ALL } from "@/components/FilterSelect";
import { PeriodPicker, initialPeriod, type PeriodState } from "@/components/PeriodPicker";
import { EmptyRow } from "@/components/Empty";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function Overview() {
  const [period, setPeriod] = useState<PeriodState>(initialPeriod);
  const [device, setDevice] = useState(ALL);
  const devices = useDevices();
  const range = periodRange(period.id, period.custom);

  const { data, error, loading } = useQuery(
    async () => {
      let t = sb.from("device_day_totals").select("*").gte("day", range.from).lte("day", range.to);
      if (device !== ALL) t = t.eq("device_id", device);
      const totals = must(await t) as DayTotal[];
      const balances =
        device === ALL
          ? (must(await sb.from("provider_balances").select("*")) as ProviderBalance[])
          : (must(await sb.from("device_balances").select("*").eq("device_id", device)) as DeviceBalance[]);
      const [review, unmatched] = await Promise.all(
        ["review", "unmatched"].map((s) =>
          sb.from("payments").select("id", { count: "exact", head: true }).eq("status", s),
        ),
      );
      return { totals, balances, review: review.count ?? 0, unmatched: unmatched.count ?? 0 };
    },
    [range.from, range.to, device],
    { refreshMs: 20000 },
  );

  const totals = data?.totals ?? [];
  const sum = summarize(totals);
  const perDevice = groupSummary(totals, (r) => r.device_id ?? "none");
  const approved = devices.list.filter((d) => d.status === "approved");
  const counted = totals.filter((r) => isCounted(r.status));

  // One row per day / provider / type, newest day first.
  const breakdown = [...groupBy(counted, (r) => `${r.day}|${r.provider}|${r.txn_type}`)]
    .map(([, rows]) => ({ ...rows[0], ...sumRows(rows) }))
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.provider.localeCompare(b.provider)));

  return (
    <Screen loading={loading || devices.loading} error={error ?? devices.error} hasData={!!data}>
      <PageHeader
        title="Overview"
        description={`${rangeLabel(range)}. Days run 12:00 AM to 11:59 PM Bangladesh time. Payments held for review are not counted.`}
        actions={
          <>
            <PeriodPicker value={period} onChange={setPeriod} />
            <FilterSelect
              label="All phones"
              value={device}
              onChange={setDevice}
              options={approved.map((d) => ({ value: d.id, label: devices.nameOf(d.id) }))}
              className="w-[calc(55%-0.25rem)] sm:w-48"
            />
          </>
        }
      />

      <div className={`mb-6 ${STAT_GRID}`}>
        <StatCard label="Payments received" value={tk(sum.received.amount)} sub={`${sum.received.n} payments · fees ${tk(sum.received.fee)}`} icon={ArrowDownToLine} />
        <StatCard label="Agent Cash Out" value={tk(sum.cashOut.amount)} sub={`${sum.cashOut.n} receipts`} icon={HandCoins} />
        <StatCard label="Commission earned" value={tk(sum.commission)} sub={`fees on cash out ${tk(sum.cashOut.fee)}`} icon={Banknote} />
        <StatCard label="Needs review" value={String(data?.review ?? 0)} sub="held, not credited" icon={Scale} />
        <StatCard label="Unmatched" value={String(data?.unmatched ?? 0)} sub="waiting for an order" icon={Clock} />
      </div>

      <section className="mb-6">
        <h3 className="mb-2 text-base font-semibold">Last known balance</h3>
        <div className={STAT_GRID}>
          {PROVIDERS.map((p) => {
            const b = (data?.balances ?? []).find((x) => x.provider === p);
            return (
              <Card key={p} className="p-4">
                <ProviderChip provider={p} className="font-medium" />
                <p className="mt-1 whitespace-nowrap text-lg font-semibold tabular sm:text-xl 2xl:text-2xl">{b ? tk(b.balance) : "–"}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {b ? `${when(b.at)}${b.device_id ? " · " + devices.nameOf(b.device_id) : ""}` : "No message with a balance yet"}
                </p>
              </Card>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Taken from the balance printed in the newest {Object.values(PROVIDER_LABEL).join(", ")} message.</p>
      </section>

      {device === ALL ? (
        <section className="mb-6">
          <h3 className="mb-2 text-base font-semibold">By phone</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Phone</TableHead>
                <TableHead className="hidden sm:table-cell">Status</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Cash Out</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Commission</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Transactions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {approved.length === 0 ? (
                <EmptyRow cols={6} text="No phone is connected yet." />
              ) : (
                approved.map((d) => {
                  const s = perDevice.get(d.id) ?? summarize([]);
                  return (
                    <TableRow
                      key={d.id}
                      className="cursor-pointer"
                      onClick={() => openPaymentsWith({ device: d.id, from: range.from, to: range.to })}
                    >
                      <TableCell className="max-w-56 whitespace-normal">
                        <DeviceChip id={d.id} name={devices.nameOf(d.id)} className="font-medium" />
                        <span className="mt-0.5 block text-xs text-muted-foreground sm:hidden">
                          comm. {tk(s.commission)} · {s.received.n + s.cashOut.n} transactions
                        </span>
                        <span className="mt-1 block sm:hidden"><DeviceHealthBadge device={d} /></span>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell"><DeviceHealthBadge device={d} /></TableCell>
                      <TableCell className="text-right tabular">{tk(s.received.amount)}</TableCell>
                      <TableCell className="text-right tabular">{tk(s.cashOut.amount)}</TableCell>
                      <TableCell className="hidden text-right tabular sm:table-cell">{tk(s.commission)}</TableCell>
                      <TableCell className="hidden text-right tabular sm:table-cell">{s.received.n + s.cashOut.n}</TableCell>
                    </TableRow>
                  );
                })
              )}
              {perDevice.has("none") ? (
                <TableRow>
                  <TableCell><DeviceChip id={null} name="Unknown phone" /></TableCell>
                  <TableCell className="hidden sm:table-cell" />
                  <TableCell className="text-right tabular">{tk(perDevice.get("none")!.received.amount)}</TableCell>
                  <TableCell className="text-right tabular">{tk(perDevice.get("none")!.cashOut.amount)}</TableCell>
                  <TableCell className="hidden text-right tabular sm:table-cell">{tk(perDevice.get("none")!.commission)}</TableCell>
                  <TableCell className="hidden text-right tabular sm:table-cell">{perDevice.get("none")!.received.n + perDevice.get("none")!.cashOut.n}</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
          <p className="mt-2 text-xs text-muted-foreground">Click a phone to see its transactions for this period.</p>
        </section>
      ) : null}

      <h3 className="mb-2 text-base font-semibold">Breakdown</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Day</TableHead>
            <TableHead className="hidden sm:table-cell">Provider</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Count</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Fee</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Commission</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {breakdown.length === 0 ? (
            <EmptyRow cols={7} />
          ) : (
            breakdown.map((r) => (
              <TableRow key={`${r.day}-${r.provider}-${r.txn_type}`}>
                <TableCell>
                  {dayLabel(r.day).slice(0, 6)}
                  <span className="hidden sm:inline">{dayLabel(r.day).slice(6)}</span>
                  <ProviderChip provider={r.provider} className="mt-0.5 flex text-xs sm:hidden" />
                </TableCell>
                <TableCell className="hidden sm:table-cell"><ProviderChip provider={r.provider} /></TableCell>
                <TableCell>
                  {TYPE_LABEL[r.txn_type] ?? r.txn_type}
                  <span className="block text-xs text-muted-foreground sm:hidden">
                    {r.n} · comm. {tk(r.commission)}
                  </span>
                </TableCell>
                <TableCell className="hidden text-right tabular sm:table-cell">{r.n}</TableCell>
                <TableCell className="text-right tabular">{tk(r.amount)}</TableCell>
                <TableCell className="hidden text-right tabular sm:table-cell">{tk(r.fee)}</TableCell>
                <TableCell className="hidden text-right tabular sm:table-cell">{tk(r.commission)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Screen>
  );
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

function sumRows(rows: DayTotal[]) {
  return rows.reduce(
    (a, r) => ({
      n: a.n + (Number(r.n) || 0),
      amount: a.amount + (Number(r.amount) || 0),
      fee: a.fee + (Number(r.fee) || 0),
      commission: a.commission + (Number(r.commission) || 0),
    }),
    { n: 0, amount: 0, fee: 0, commission: 0 },
  );
}
