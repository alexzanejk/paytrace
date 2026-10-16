import { useState } from "react";
import { ArrowDownToLine, Banknote, Clock, HandCoins, Scale } from "lucide-react";
import { must, sb } from "@/lib/supabase";
import { dhakaDate, tk } from "@/lib/format";
import { PROVIDER_LABEL, TYPE_LABEL, type Totals } from "@/lib/types";
import { useQuery } from "@/hooks/useQuery";
import { Screen } from "@/components/Screen";
import { StatCard } from "@/components/StatCard";
import { EmptyRow } from "@/components/Empty";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const RANGES = [
  { value: "1", label: "Today" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
];

export function Overview() {
  const [range, setRange] = useState("1");

  const { data, error, loading } = useQuery(
    async () => {
      const from = new Date(Date.now() - (Number(range) - 1) * 864e5);
      const totals = must(await sb.from("payment_totals").select("*").gte("day", dhakaDate(from))) as Totals[];
      const [review, unmatched] = await Promise.all(
        ["review", "unmatched"].map((s) =>
          sb.from("payments").select("id", { count: "exact", head: true }).eq("status", s),
        ),
      );
      return { totals, review: review.count ?? 0, unmatched: unmatched.count ?? 0 };
    },
    [range],
    { refreshMs: 20000 },
  );

  const totals = data?.totals ?? [];
  const sum = (rows: Totals[], f: keyof Totals) => rows.reduce((a, r) => a + Number(r[f] || 0), 0);
  const incoming = totals.filter((r) => r.txn_type === "payment_received" || r.txn_type === "send_money_received");
  const cashOut = totals.filter((r) => r.txn_type === "cash_out");
  const rows = [...totals].sort((a, b) => (a.day < b.day ? 1 : -1));

  return (
    <Screen loading={loading} error={error} hasData={!!data}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{RANGES.find((r) => r.value === range)?.label}</h2>
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="w-40" aria-label="Date range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RANGES.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard
          label="Payments received"
          value={tk(sum(incoming, "amount"))}
          sub={`${sum(incoming, "n")} payments · fees ${tk(sum(incoming, "fee"))}`}
          icon={ArrowDownToLine}
        />
        <StatCard
          label="Agent Cash Out"
          value={tk(sum(cashOut, "amount"))}
          sub={`${sum(cashOut, "n")} receipts`}
          icon={HandCoins}
        />
        <StatCard
          label="Commission earned"
          value={tk(sum(totals, "commission"))}
          sub={`fees on cash out ${tk(sum(cashOut, "fee"))}`}
          icon={Banknote}
        />
        <StatCard label="Needs review" value={String(data?.review ?? 0)} sub="held, not credited" icon={Scale} />
        <StatCard label="Unmatched" value={String(data?.unmatched ?? 0)} sub="waiting for an order" icon={Clock} />
      </div>

      <h3 className="mb-2 text-base font-semibold">Breakdown</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Day</TableHead>
            <TableHead>Provider</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Count</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Fee</TableHead>
            <TableHead className="text-right">Commission</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <EmptyRow cols={7} />
          ) : (
            rows.map((r) => (
              <TableRow key={`${r.day}-${r.provider}-${r.txn_type}`}>
                <TableCell>{r.day}</TableCell>
                <TableCell>{PROVIDER_LABEL[r.provider] ?? r.provider}</TableCell>
                <TableCell>{TYPE_LABEL[r.txn_type] ?? r.txn_type}</TableCell>
                <TableCell className="text-right">{r.n}</TableCell>
                <TableCell className="text-right">{tk(r.amount)}</TableCell>
                <TableCell className="text-right">{tk(r.fee)}</TableCell>
                <TableCell className="text-right">{tk(r.commission)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Screen>
  );
}
