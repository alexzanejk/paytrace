import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, Search } from "lucide-react";
import { must, sb } from "@/lib/supabase";
import { tk, when } from "@/lib/format";
import { PROVIDERS, PROVIDER_LABEL, TYPE_LABEL, type Payment } from "@/lib/types";
import { COUNTED_STATUSES, rangeBounds, rangeLabel, periodRange, summarize, type DayTotal } from "@/lib/period";
import { takePaymentsPreset } from "@/lib/filters";
import { downloadText, toCsv } from "@/lib/csv";
import { reviewReasonText } from "@/lib/reasons";
import { useQuery } from "@/hooks/useQuery";
import { useDevices } from "@/hooks/useDevices";
import { Screen } from "@/components/Screen";
import { PageHeader } from "@/components/PageHeader";
import { StatCard, STAT_GRID } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { ChainBadge } from "@/components/ChainBadge";
import { DeviceChip } from "@/components/DeviceChip";
import { ProviderChip } from "@/components/ProviderChip";
import { FilterSelect, ALL } from "@/components/FilterSelect";
import { PeriodPicker, initialPeriod, type PeriodState } from "@/components/PeriodPicker";
import { EmptyRow } from "@/components/Empty";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const STATUSES = ["matched", "unmatched", "review", "tracked_only", "ignored"];
const PAGE = 100;
const NO_DEVICE = "none";

/** Only letters, digits and a few safe symbols reach the search filter, so typed text can never change the query. */
const safeSearch = (q: string) => q.replace(/[^A-Za-z0-9*+\-]/g, "").slice(0, 40);

export function Payments() {
  const preset = useMemo(() => takePaymentsPreset(), []);
  const [device, setDevice] = useState(preset?.device ?? ALL);
  const [provider, setProvider] = useState(preset?.provider ?? ALL);
  const [status, setStatus] = useState(ALL);
  const [type, setType] = useState(ALL);
  const [period, setPeriod] = useState<PeriodState>(() => {
    const p = initialPeriod();
    return preset?.from ? { id: "custom", custom: { from: preset.from, to: preset.to ?? preset.from } } : p;
  });
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const devices = useDevices();

  // Wait for the typing to pause before asking the server.
  useEffect(() => {
    const id = setTimeout(() => setTerm(safeSearch(search)), 300);
    return () => clearTimeout(id);
  }, [search]);
  useEffect(() => setLimit(PAGE), [device, provider, status, type, period, term]);

  const range = periodRange(period.id, period.custom);
  const { startIso, endIso } = rangeBounds(range);

  const { data, error, loading } = useQuery(
    async () => {
      let q = sb
        .from("payments")
        .select("*", { count: "exact" })
        .eq("source", "app")
        .or(
          `and(occurred_at.gte.${startIso},occurred_at.lt.${endIso}),and(occurred_at.is.null,received_at.gte.${startIso},received_at.lt.${endIso})`,
        )
        .order("received_at", { ascending: false })
        .limit(limit);
      if (device === NO_DEVICE) q = q.is("device_id", null);
      else if (device !== ALL) q = q.eq("device_id", device);
      if (provider !== ALL) q = q.eq("provider", provider);
      if (status !== ALL) q = q.eq("status", status);
      if (type !== ALL) q = q.eq("txn_type", type);
      if (term) q = q.or(`trx_id.ilike.%${term}%,counterparty.ilike.%${term}%`);
      const res = await q;
      if (res.error) throw new Error(res.error.message);

      // Totals for the same period, phone, provider and type (and status), counted the same way as the Overview.
      let t = sb.from("device_day_totals").select("*").gte("day", range.from).lte("day", range.to);
      if (device === NO_DEVICE) t = t.is("device_id", null);
      else if (device !== ALL) t = t.eq("device_id", device);
      if (provider !== ALL) t = t.eq("provider", provider);
      if (type !== ALL) t = t.eq("txn_type", type);
      t = status !== ALL ? t.eq("status", status) : t.in("status", COUNTED_STATUSES);
      const totals = must(await t) as DayTotal[];
      return { rows: (res.data ?? []) as Payment[], total: res.count ?? 0, totals };
    },
    [device, provider, status, type, startIso, endIso, term, limit],
    { refreshMs: 20000 },
  );

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const sum = summarize((data?.totals ?? []).map((r) => ({ ...r, status: status !== ALL ? "matched" : r.status })));
  const nTx = sum.received.n + sum.cashOut.n;

  function exportCsv() {
    const csv = toCsv(
      ["Time (BD)", "Phone", "Provider", "Type", "TrxID", "Amount", "Fee", "Commission", "Balance after", "From", "Status"],
      rows.map((p) => [
        when(p.occurred_at ?? p.received_at), devices.nameOf(p.device_id), PROVIDER_LABEL[p.provider] ?? p.provider,
        TYPE_LABEL[p.txn_type] ?? p.txn_type, p.trx_id, p.amount, p.fee, p.commission, p.balance ?? "", p.counterparty ?? "", p.status,
      ]),
    );
    downloadText(`paytrace-${range.from}_${range.to}.csv`, csv);
  }

  const phoneOptions = [
    // Removed phones are not offered as a filter; their old transactions still show under "All phones".
    ...devices.list.filter((d) => d.status === "approved").map((d) => ({ value: d.id, label: devices.nameOf(d.id) })),
    { value: NO_DEVICE, label: "Unknown phone" },
  ];

  return (
    <Screen loading={loading || devices.loading} error={error ?? devices.error} hasData={!!data}>
      <PageHeader
        title="Transactions"
        description={`Every payment message the phones have sent. Showing ${rangeLabel(range)} (days run 12:00 AM to 11:59 PM Bangladesh time).`}
        actions={
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
            <Download aria-hidden /> Download CSV
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <PeriodPicker value={period} onChange={setPeriod} />
        <FilterSelect label="All phones" value={device} onChange={setDevice} options={phoneOptions} className="w-[calc(50%-0.25rem)] sm:w-48" />
        <FilterSelect
          label="All providers"
          value={provider}
          onChange={setProvider}
          options={PROVIDERS.map((p) => ({ value: p, label: PROVIDER_LABEL[p] }))}
        />
        <FilterSelect
          label="All types"
          value={type}
          onChange={setType}
          options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <FilterSelect
          label="All statuses"
          value={status}
          onChange={setStatus}
          options={STATUSES.map((s) => ({ value: s, label: s.replace("_", " ") }))}
        />
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input className="pl-9" placeholder="Search TrxID or number" aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className={`mb-5 ${STAT_GRID}`}>
        <StatCard label="Received" value={tk(sum.received.amount)} sub={`${sum.received.n} payments`} />
        <StatCard label="Agent Cash Out" value={tk(sum.cashOut.amount)} sub={`${sum.cashOut.n} receipts`} />
        <StatCard label="Commission" value={tk(sum.commission)} sub="from these receipts" />
        <StatCard label="Transactions" value={String(nTx)} sub={status === ALL ? "held for review not counted" : `status: ${status.replace("_", " ")}`} />
      </div>

      {/* Wide screens: a table. Phones: one card per transaction. */}
      <div className="hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Time (BD)</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>TrxID</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="hidden text-right 2xl:table-cell">Balance after</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow cols={9} text="No transactions match these filters." />
            ) : (
              rows.map((p) => {
                const isOpen = open === p.id;
                return (
                  <Fragment key={p.id}>
                    <TableRow className="cursor-pointer" onClick={() => setOpen(isOpen ? null : p.id)}>
                      <TableCell>{isOpen ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}</TableCell>
                      <TableCell>{when(p.occurred_at ?? p.received_at)}</TableCell>
                      <TableCell className="max-w-44"><DeviceChip id={p.device_id} name={devices.nameOf(p.device_id)} /></TableCell>
                      <TableCell>
                        <ProviderChip provider={p.provider} />
                        <span className="block text-xs text-muted-foreground">{TYPE_LABEL[p.txn_type] ?? p.txn_type}</span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{p.trx_id}</TableCell>
                      <TableCell className="text-right font-medium tabular">{tk(p.amount)}</TableCell>
                      <TableCell className="hidden text-right tabular text-muted-foreground 2xl:table-cell">{tk(p.balance)}</TableCell>
                      <TableCell><StatusBadge status={p.status} /></TableCell>
                    </TableRow>
                    {isOpen ? (
                      <TableRow>
                        <TableCell />
                        <TableCell colSpan={8}><Details p={p} /></TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-3 lg:hidden">
        {rows.length === 0 ? <p className="py-8 text-center text-muted-foreground">No transactions match these filters.</p> : null}
        {rows.map((p) => (
          <Card key={p.id} className="p-4">
            <button type="button" className="w-full text-left" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <ProviderChip provider={p.provider} className="font-medium" />
                  <p className="text-xs text-muted-foreground">{TYPE_LABEL[p.txn_type] ?? p.txn_type}</p>
                </div>
                <p className="text-lg font-semibold tabular">{tk(p.amount)}</p>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <DeviceChip id={p.device_id} name={devices.nameOf(p.device_id)} />
                <span>{when(p.occurred_at ?? p.received_at)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="font-mono text-xs">{p.trx_id}</span>
                <StatusBadge status={p.status} />
              </div>
            </button>
            {open === p.id ? <div className="mt-3 border-t border-border pt-3"><Details p={p} /></div> : null}
          </Card>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>
          Showing {rows.length} of {total}
        </span>
        {rows.length < total ? (
          <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
            Load {Math.min(PAGE, total - rows.length)} more
          </Button>
        ) : null}
      </div>
    </Screen>
  );
}

/** Everything else about one transaction. The SMS is shown as plain text, never as HTML. */
function Details({ p }: { p: Payment }) {
  return (
    <div className="grid gap-3 text-sm sm:grid-cols-2">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">Fee</dt>
        <dd className="tabular">{tk(p.fee)}</dd>
        <dt className="text-muted-foreground">Commission</dt>
        <dd className="tabular">{tk(p.commission)}</dd>
        <dt className="text-muted-foreground">From</dt>
        <dd>{p.counterparty ?? "–"}</dd>
        <dt className="text-muted-foreground">Arrived</dt>
        <dd>{when(p.received_at)}</dd>
        <dt className="text-muted-foreground">Balance check</dt>
        <dd><ChainBadge status={p.chain_status} delta={p.balance_delta} /></dd>
        {p.review_reason ? (
          <>
            <dt className="text-muted-foreground">Held because</dt>
            <dd>{reviewReasonText(p.review_reason)}</dd>
          </>
        ) : null}
      </dl>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">{p.raw_message}</pre>
    </div>
  );
}
