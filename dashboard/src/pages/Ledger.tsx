import { useEffect, useMemo, useState } from "react";
import { Download, FileClock } from "lucide-react";
import { must, sb } from "@/lib/supabase";
import { tk } from "@/lib/format";
import { PROVIDER_LABEL, type Device } from "@/lib/types";
import { toCsv, downloadText } from "@/lib/csv";
import { nudgePhone } from "@/lib/wake";
import { useQuery } from "@/hooks/useQuery";
import {
  defaultRange, groupByDay, isIn, kindLabel, ledgerCounts, ledgerCsv, rangeProblem, SOURCE_WORDS, type LedgerRow,
} from "@/lib/ledger";
import { takeLedgerPreset } from "@/lib/ledgerNav";
import { Screen } from "@/components/Screen";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/StatusBadge";
import { ChainBadge } from "@/components/ChainBadge";

const WALLETS = ["bkash", "nagad", "rocket", "upay"] as const;
const PULL_WALLETS = ["bkash", "nagad"];

interface LedgerSettings { auto_pull: boolean; times_per_day: number }

/** Every transaction of one phone's wallet in time order, like the wallet app's own history: SMS rows and the wallet's
 *  statement lines merged (migration 059). A line the statement lists but no SMS came for is shown in amber. */
export function Ledger() {
  const preset = useMemo(() => takeLedgerPreset(), []);
  const [device, setDevice] = useState(preset?.device ?? "");
  const [provider, setProvider] = useState(preset?.provider ?? "bkash");
  const [range, setRange] = useState(defaultRange());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const phones = useQuery(async () => {
    const [devices, settings] = await Promise.all([
      sb.from("devices").select("id,name,pair_code,status,info").eq("status", "approved").order("name"),
      sb.from("ledger_settings").select("auto_pull,times_per_day").maybeSingle(),
    ]);
    return { devices: must(devices) as Device[], settings: (settings.data ?? { auto_pull: true, times_per_day: 2 }) as LedgerSettings };
  }, []);

  useEffect(() => {
    if (!device && phones.data?.devices.length) setDevice(phones.data.devices[0].id);
  }, [phones.data, device]);

  const problem = rangeProblem(range.from, range.to);
  const ledger = useQuery(
    async () => {
      if (!device || problem) return [] as LedgerRow[];
      const { data, error } = await sb.rpc("wallet_ledger", { p_device: device, p_provider: provider, p_from: range.from, p_to: range.to });
      if (error) throw new Error(error.message);
      return (data ?? []) as LedgerRow[];
    },
    [device, provider, range.from, range.to, problem],
    { refreshMs: 30000 },
  );

  const rows = ledger.data ?? [];
  const days = groupByDay(rows);
  const counts = ledgerCounts(rows);
  const phone = phones.data?.devices.find((d) => d.id === device);
  const walletSlot = phone?.info?.wallets?.find((w) => w.provider === provider)?.slot;

  async function pullNow() {
    setBusy(true);
    setNote("");
    const { error } = await sb.rpc("queue_statement_command", { p_device: device, p_provider: provider, p_item: null });
    setBusy(false);
    if (error) { setNote(error.message); return; }
    nudgePhone(device);
    setNote("Asked the phone for the wallet's statement. It takes about a minute; this page refreshes by itself.");
  }

  async function saveSettings(next: Partial<LedgerSettings>) {
    const cur = phones.data?.settings ?? { auto_pull: true, times_per_day: 2 };
    const { error } = await sb.rpc("set_ledger_settings", { p_auto: next.auto_pull ?? cur.auto_pull, p_times: next.times_per_day ?? cur.times_per_day });
    if (error) setNote(error.message);
    phones.refresh();
  }

  function exportCsv() {
    const data = ledgerCsv(rows);
    downloadText(`ledger-${phone?.name ?? "phone"}-${provider}-${range.from}-${range.to}.csv`, toCsv(data[0] as string[], data.slice(1)));
  }

  const settings = phones.data?.settings;

  return (
    <Screen loading={phones.loading} error={phones.error} hasData={!!phones.data}>
      <PageHeader
        title="Wallet ledger"
        description="Every transaction of one wallet in time order, as the wallet app shows it: what arrived as an SMS plus what only the wallet's own statement lists."
        actions={<Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}><Download aria-hidden /> CSV</Button>}
      />

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Phone</span>
            <Select value={device} onValueChange={setDevice}>
              <SelectTrigger className="w-56" aria-label="Phone"><SelectValue placeholder="Phone" /></SelectTrigger>
              <SelectContent>{(phones.data?.devices ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name || d.pair_code}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Wallet</span>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger className="w-36" aria-label="Wallet"><SelectValue /></SelectTrigger>
              <SelectContent>{WALLETS.map((w) => <SelectItem key={w} value={w}>{PROVIDER_LABEL[w] ?? w}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">From</span>
            <Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="w-40" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">To</span>
            <Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="w-40" />
          </label>
          <Button size="sm" variant="outline" onClick={() => setRange(defaultRange())}>Last 3 days</Button>
          {PULL_WALLETS.includes(provider) ? (
            <Button size="sm" onClick={() => void pullNow()} disabled={busy || !device}><FileClock aria-hidden /> Pull statement now</Button>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
          <span>{rows.length} rows · {counts.both} confirmed by the statement · <span className={counts.statementOnly ? "font-medium text-amber-700 dark:text-amber-400" : ""}>{counts.statementOnly} with no SMS</span> · {counts.smsOnly} SMS only</span>
          {walletSlot != null ? <span>This wallet is on SIM {walletSlot + 1}; rows from the other SIM are not shown.</span> : null}
          {settings ? (
            <span className="flex items-center gap-2">
              <Switch checked={settings.auto_pull} onCheckedChange={(on) => void saveSettings({ auto_pull: on })} aria-label="Pull every wallet's statement on a schedule" />
              Pull statements by itself
              <Select value={String(settings.times_per_day)} onValueChange={(v) => void saveSettings({ times_per_day: Number(v) })}>
                <SelectTrigger className="h-8 w-32" aria-label="Pulls per day"><SelectValue /></SelectTrigger>
                <SelectContent>{[1, 2, 3, 4].map((n) => <SelectItem key={n} value={String(n)}>{n}× a day</SelectItem>)}</SelectContent>
              </Select>
            </span>
          ) : null}
        </div>
        {problem ? <p className="mt-2 text-sm text-destructive">{problem}</p> : null}
        {note ? <p className="mt-2 text-sm">{note}</p> : null}
        {ledger.error ? <p className="mt-2 text-sm text-destructive">{ledger.error}</p> : null}
      </Card>

      {!ledger.loading && rows.length === 0 && !problem ? (
        <Card className="p-6 text-sm text-muted-foreground">Nothing in this window for this wallet. Press “Pull statement now” to fetch the wallet&apos;s own list, or widen the dates.</Card>
      ) : null}

      <div className="space-y-4">
        {days.map((d) => (
          <Card key={d.day} className="overflow-hidden p-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b bg-muted/40 px-4 py-2 text-sm">
              <span className="font-medium">{new Date(d.day + "T00:00:00+06:00").toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Dhaka" })}</span>
              <span className="text-muted-foreground">In {tk(d.in)} · Out {tk(d.out)} · {d.rows.length} rows</span>
            </div>
            <ul className="divide-y">
              {d.rows.map((r, i) => {
                const inn = isIn(r.kind, r.amount);
                const stmtOnly = r.source === "statement";
                return (
                  <li key={r.payment_id ?? `${r.sort_at}-${i}`} className={`grid grid-cols-[4.5rem_1fr_auto] gap-x-3 gap-y-1 px-4 py-2 text-sm sm:grid-cols-[5rem_1fr_8rem_8rem] ${stmtOnly ? "bg-amber-50 dark:bg-amber-950/30" : ""}`}>
                    <span className="tabular text-muted-foreground" title={r.exact_time ? "Time from the SMS" : "No exact time: placed between its neighbours in the wallet's own list"}>
                      {new Date(r.sort_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dhaka" })}{r.exact_time ? "" : "≈"}
                    </span>
                    <span className="min-w-0">
                      <span className="font-medium">{kindLabel(r.kind, r.label)}</span>
                      {r.counterparty ? <span className="text-muted-foreground"> · {r.counterparty}</span> : null}
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        {r.trx_id ? <span className="font-mono">{r.trx_id}</span> : null}
                        <Badge className={stmtOnly ? "bg-amber-600 text-white hover:bg-amber-600" : ""}>{SOURCE_WORDS[r.source] ?? r.source}</Badge>
                        {r.status && r.status !== "statement" ? <StatusBadge status={r.status} /> : null}
                        {r.chain_status ? <ChainBadge status={r.chain_status} delta={null} /> : null}
                      </span>
                    </span>
                    <span className={`tabular text-right font-medium ${inn ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}>{inn ? "+" : "−"}{tk(Math.abs(Number(r.amount)))}</span>
                    <span className="tabular text-right text-muted-foreground max-sm:col-start-3">{r.balance == null ? "" : `bal ${tk(Number(r.balance))}`}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>
    </Screen>
  );
}
