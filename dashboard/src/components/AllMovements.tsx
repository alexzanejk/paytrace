import { useMemo, useState } from "react";
import type { PaymentsPreset } from "@/lib/filters";
import { Download, Search } from "lucide-react";
import { sb } from "@/lib/supabase";
import { tk, when } from "@/lib/format";
import { PROVIDERS, PROVIDER_LABEL } from "@/lib/types";
import { periodRange, rangeLabel } from "@/lib/period";
import { downloadText, toCsv } from "@/lib/csv";
import { reviewReasonText } from "@/lib/reasons";
import { PAYMENT_STATUS } from "@/lib/words";
import { clampRange, filterMovements, GROUPS, kindLabel, SEEN_LABEL, totals, type Movement } from "@/lib/movements";
import { useQuery } from "@/hooks/useQuery";
import { useDevices } from "@/hooks/useDevices";
import { Screen } from "@/components/Screen";
import { StatCard, STAT_GRID } from "@/components/StatCard";
import { DeviceChip } from "@/components/DeviceChip";
import { ProviderChip } from "@/components/ProviderChip";
import { FilterSelect, ALL } from "@/components/FilterSelect";
import { PeriodPicker, initialPeriod, type PeriodState } from "@/components/PeriodPicker";
import { EmptyRow } from "@/components/Empty";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const PAGE = 200;

/** Every movement of every wallet: each SMS, plus what the wallet's own list shows that no SMS did (agent Cash Ins and
 *  B2Bs often send no SMS), plus PayTrace's own sends. Read only. */
export function AllMovements({ preset }: { preset?: PaymentsPreset | null }) {
  const devices = useDevices();
  const [period, setPeriod] = useState<PeriodState>(() =>
    preset?.from ? { id: "custom", custom: { from: preset.from, to: preset.to ?? preset.from } } : initialPeriod());
  const [device, setDevice] = useState(preset?.device ?? ALL);
  const [provider, setProvider] = useState(preset?.provider ?? ALL);
  const [group, setGroup] = useState(ALL);
  const [direction, setDirection] = useState(ALL);
  const [seen, setSeen] = useState(ALL);
  const [term, setTerm] = useState(preset?.search ?? "");
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<number | null>(null);

  const asked = periodRange(period.id, period.custom);
  const range = clampRange(asked.from, asked.to);

  const { data, error, loading } = useQuery(
    async () => {
      const r = await sb.rpc("all_movements", { p_from: range.from, p_to: range.to });
      if (r.error) throw new Error(r.error.message);
      return (r.data ?? []) as Movement[];
    },
    [range.from, range.to],
    { refreshMs: 30000 },
  );

  const shown = useMemo(
    () => filterMovements(data ?? [], { device, provider, group, direction: direction as "in" | "out" | "all", seen, term }),
    [data, device, provider, group, direction, seen, term],
  );
  const sum = totals(shown);
  const rows = shown.slice(0, limit);

  function exportCsv() {
    const csv = toCsv(
      ["Time (BD)", "Exact time", "Phone", "Wallet", "Account", "Type", "Amount", "Commission", "Balance after", "TrxID", "Number", "Seen in", "Status"],
      shown.map((m) => [
        when(m.at), m.exact_time ? "yes" : "date only", devices.nameOf(m.device_id), PROVIDER_LABEL[m.provider] ?? m.provider,
        m.account ?? "", kindLabel(m.kind, m.provider), m.amount, m.commission ?? "", m.balance ?? "", m.trx_id ?? "",
        m.counterparty ?? "", SEEN_LABEL[m.seen] ?? m.seen, statusWord(m),
      ]),
    );
    downloadText(`paytrace-all-${range.from}_${range.to}.csv`, csv);
  }

  const phoneOptions = devices.list.filter((d) => d.status === "approved").map((d) => ({ value: d.id, label: devices.nameOf(d.id) }));

  return (
    <Screen loading={loading || devices.loading} error={error ?? devices.error} hasData={!!data}>
      <p className="mb-3 text-sm text-muted-foreground">
        Every transaction of every wallet: each SMS, plus what the wallet's own list shows that no SMS did (an agent Cash In
        or a B2B often sends no SMS; the phone reads the bKash and Nagad agent apps every 30 minutes), plus what PayTrace
        sent itself. Each movement is listed once. {rangeLabel(range)}
        {range.clamped ? " (the last 31 days of the period you chose: at most 31 days at a time)" : ""}.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <PeriodPicker value={period} onChange={(v) => { setPeriod(v); setLimit(PAGE); }} />
        <FilterSelect label="All phones" value={device} onChange={setDevice} options={phoneOptions} className="w-[calc(50%-0.25rem)] sm:w-48" />
        <FilterSelect label="All wallets" value={provider} onChange={setProvider} options={PROVIDERS.map((p) => ({ value: p, label: PROVIDER_LABEL[p] }))} />
        <FilterSelect label="All types" value={group} onChange={setGroup} options={GROUPS.map((g) => ({ value: g.id, label: g.label }))} className="w-[calc(50%-0.25rem)] sm:w-56" />
        <FilterSelect label="In and out" value={direction} onChange={setDirection} options={[{ value: "in", label: "Money in" }, { value: "out", label: "Money out" }]} />
        <FilterSelect label="Seen anywhere" value={seen} onChange={setSeen} options={Object.entries(SEEN_LABEL).map(([value, label]) => ({ value, label }))} className="w-[calc(50%-0.25rem)] sm:w-52" />
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input className="pl-9" placeholder="Search TrxID or number" aria-label="Search" value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={shown.length === 0}>
          <Download aria-hidden /> Download CSV
        </Button>
      </div>

      <div className={`mb-5 ${STAT_GRID}`}>
        <StatCard label="Money in" value={tk(sum.moneyIn)} sub="everything that came into these wallets" tone="green" />
        <StatCard label="Money out" value={tk(sum.moneyOut)} sub="everything that left them" tone="rose" />
        <StatCard label="Transactions" value={String(sum.n)} sub={`${sum.noSms} with no SMS (seen only in the wallet or sent by PayTrace)`} />
        <StatCard
          label="Cash Out / Cash In / B2B"
          value={`${sum.byGroup.cash_out?.n ?? 0} / ${sum.byGroup.cash_in?.n ?? 0} / ${sum.byGroup.b2b?.n ?? 0}`}
          sub="how many of each"
        />
      </div>

      <div className="hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time (BD)</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Wallet</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>TrxID / number</TableHead>
              <TableHead title="SMS = the wallet's SMS; No SMS = only in the wallet's own list (app read or statement); PayTrace = sent by PayTrace itself">Seen in</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow cols={7} text="No transactions match these filters." />
            ) : (
              rows.map((m, i) => (
                <TableRow key={i} className="cursor-pointer align-top" onClick={() => setOpen(open === i ? null : i)}>
                  <TableCell className="whitespace-nowrap">{timeText(m)}</TableCell>
                  <TableCell className="max-w-44"><DeviceChip id={m.device_id} name={devices.nameOf(m.device_id)} /></TableCell>
                  <TableCell>
                    <ProviderChip provider={m.provider} />
                    {m.account === "personal" ? <span className="block text-xs text-muted-foreground">personal account</span> : null}
                  </TableCell>
                  <TableCell>
                    {kindLabel(m.kind, m.provider)}
                    {open === i ? <More m={m} /> : null}
                  </TableCell>
                  <TableCell className={`text-right font-medium tabular ${m.amount < 0 ? "text-status-bad" : "text-status-ok"}`}>
                    {m.amount < 0 ? "−" : "+"}{tk(Math.abs(m.amount))}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {m.trx_id ?? ""}
                    {m.counterparty ? <span className="block text-muted-foreground">{m.counterparty}</span> : null}
                  </TableCell>
                  <TableCell><SeenBadge m={m} /></TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-3 lg:hidden">
        {rows.length === 0 ? <p className="py-8 text-center text-muted-foreground">No transactions match these filters.</p> : null}
        {rows.map((m, i) => (
          <Card key={i} className="p-4">
            <button type="button" className="w-full text-left" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <ProviderChip provider={m.provider} className="font-medium" />
                  <span className="block text-sm">{kindLabel(m.kind, m.provider)}</span>
                </div>
                <p className={`text-lg font-semibold tabular ${m.amount < 0 ? "text-status-bad" : "text-status-ok"}`}>
                  {m.amount < 0 ? "−" : "+"}{tk(Math.abs(m.amount))}
                </p>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <DeviceChip id={m.device_id} name={devices.nameOf(m.device_id)} />
                <span>{timeText(m)}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="break-all font-mono text-xs">{m.trx_id ?? m.counterparty ?? ""}</span>
                <SeenBadge m={m} />
              </div>
            </button>
            {open === i ? <More m={m} /> : null}
          </Card>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>Showing {rows.length} of {shown.length}</span>
        {rows.length < shown.length ? (
          <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE)}>Load {Math.min(PAGE, shown.length - rows.length)} more</Button>
        ) : null}
      </div>
    </Screen>
  );
}

function timeText(m: Movement): string {
  if (m.exact_time) return when(m.at);
  const d = new Date(`${m.day}T12:00:00+06:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Dhaka" });
  return `${d} (no time)`;
}

const SEEN_SHORT: Record<string, string> = { sms: "SMS", both: "SMS + list", wallet: "No SMS", paytrace: "PayTrace" };

function statusWord(m: Movement): string {
  if (m.seen === "wallet") return "In the wallet's list";
  if (m.seen === "paytrace") return "Sent by PayTrace";
  return PAYMENT_STATUS[m.status]?.label ?? m.status;
}

function SeenBadge({ m }: { m: Movement }) {
  const tone = m.seen === "wallet" ? "warn" : m.seen === "paytrace" ? "info" : m.status === "review" ? "warn" : "ok";
  return <Badge tone={tone} title={SEEN_LABEL[m.seen] ?? m.seen} className="whitespace-nowrap">{SEEN_SHORT[m.seen] ?? m.seen}</Badge>;
}

/** The rest of one row. SMS text is shown as plain text, never as HTML. */
function More({ m }: { m: Movement }) {
  return (
    <div className="mt-2 space-y-1 text-xs text-muted-foreground">
      {m.commission ? <p>Commission {tk(m.commission)}</p> : null}
      {m.balance != null ? <p>Balance after {tk(m.balance)}</p> : null}
      {m.counterparty ? <p>Number {m.counterparty}</p> : null}
      <p>Status: {statusWord(m)}{m.review_reason ? ` · ${reviewReasonText(m.review_reason)}` : ""}</p>
      {m.raw ? <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs text-foreground">{m.raw}</pre> : null}
    </div>
  );
}
