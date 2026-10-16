import { useState } from "react";
import { must, sb } from "@/lib/supabase";
import { tk, when } from "@/lib/format";
import { PROVIDERS, PROVIDER_LABEL, TYPE_LABEL, type Payment } from "@/lib/types";
import { useQuery } from "@/hooks/useQuery";
import { Screen } from "@/components/Screen";
import { StatusBadge } from "@/components/StatusBadge";
import { ChainBadge } from "@/components/ChainBadge";
import { EmptyRow } from "@/components/Empty";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const ALL = "all";
const STATUSES = ["matched", "unmatched", "review", "tracked_only", "ignored"];

function Filter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-44" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function Payments() {
  const [provider, setProvider] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [type, setType] = useState(ALL);

  const { data, error, loading } = useQuery(
    async () => {
      let q = sb.from("payments").select("*").eq("source", "app").order("received_at", { ascending: false }).limit(200);
      if (provider !== ALL) q = q.eq("provider", provider);
      if (status !== ALL) q = q.eq("status", status);
      if (type !== ALL) q = q.eq("txn_type", type);
      return must(await q) as Payment[];
    },
    [provider, status, type],
    { refreshMs: 20000 },
  );

  const rows = data ?? [];

  return (
    <Screen loading={loading} error={error} hasData={!!data}>
      <div className="mb-4 flex flex-wrap gap-2">
        <Filter
          label="All providers"
          value={provider}
          onChange={setProvider}
          options={PROVIDERS.map((p) => ({ value: p, label: PROVIDER_LABEL[p] }))}
        />
        <Filter
          label="All statuses"
          value={status}
          onChange={setStatus}
          options={STATUSES.map((s) => ({ value: s, label: s.replace("_", " ") }))}
        />
        <Filter
          label="All types"
          value={type}
          onChange={setType}
          options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))}
        />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time (BD)</TableHead>
            <TableHead>Provider</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>TrxID</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Fee</TableHead>
            <TableHead className="text-right">Commission</TableHead>
            <TableHead className="text-right">Balance</TableHead>
            <TableHead>From</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Balance check</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <EmptyRow cols={11} text="No payments match these filters." />
          ) : (
            rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell>{when(p.occurred_at ?? p.received_at)}</TableCell>
                <TableCell>{PROVIDER_LABEL[p.provider] ?? p.provider}</TableCell>
                <TableCell>{TYPE_LABEL[p.txn_type] ?? p.txn_type}</TableCell>
                <TableCell className="font-mono text-xs">{p.trx_id}</TableCell>
                <TableCell className="text-right">{tk(p.amount)}</TableCell>
                <TableCell className="text-right">{tk(p.fee)}</TableCell>
                <TableCell className="text-right">{tk(p.commission)}</TableCell>
                <TableCell className="text-right">{tk(p.balance)}</TableCell>
                <TableCell>{p.counterparty ?? "–"}</TableCell>
                <TableCell>
                  <StatusBadge status={p.status} />
                </TableCell>
                <TableCell>
                  <ChainBadge status={p.chain_status} delta={p.balance_delta} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Screen>
  );
}
