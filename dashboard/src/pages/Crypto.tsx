import { useState, type FormEvent } from "react";
import { Coins } from "lucide-react";
import { must, sb } from "@/lib/supabase";
import { when } from "@/lib/format";
import { PROVIDER_LABEL } from "@/lib/types";
import { useQuery } from "@/hooks/useQuery";
import { Screen } from "@/components/Screen";
import { PageHeader } from "@/components/PageHeader";
import { StatCard, STAT_GRID } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { CopyButton } from "@/components/CopyButton";
import { Confirm } from "@/components/Confirm";
import { EmptyRow } from "@/components/Empty";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Settings {
  taka_per_usdt: number | null;
  order_minutes: number;
  bep20_enabled: boolean;
  bep20_address: string | null;
  bep20_checked_at: string | null;
  bep20_error: string | null;
  trc20_enabled: boolean;
  trc20_address: string | null;
  trc20_checked_at: string | null;
  trc20_error: string | null;
}
interface Transfer {
  id: string;
  chain: "bep20" | "trc20";
  tx_hash: string;
  from_address: string | null;
  amount: number;
  block_time: string;
  status: string;
  review_reason: string | null;
  order_id: string | null;
}
interface OpenOrder {
  id: string;
  order_no: string;
  merchant_order_id: string | null;
  expected_amount: number;
  crypto_chain: "bep20" | "trc20";
  crypto_amount: number;
  status: string;
}

const short = (s: string | null, n = 6) => (s && s.length > 2 * n + 3 ? `${s.slice(0, n)}…${s.slice(-n)}` : s ?? "–");
const usdt = (n: number) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const ago = (t: string | null) => {
  if (!t) return "not checked yet";
  const s = Math.max(0, Math.round((Date.now() - new Date(t).getTime()) / 1000));
  return s < 90 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};

/** USDT deposits (BEP20 and TRC20). Websites create deposits in taka; PayTrace turns them into an exact USDT amount and pays the
 *  order when that exact amount reaches the receiving address. Only PUBLIC addresses are entered here, never keys or seed words. */
export function Crypto() {
  const { data, error, loading, refresh } = useQuery(
    async () => {
      const settings = must(await sb.from("crypto_settings").select("*").eq("id", true).single()) as Settings;
      const transfers = must(await sb.from("crypto_transfers").select("*").order("block_time", { ascending: false }).limit(100)) as Transfer[];
      const open = must(
        await sb.from("orders").select("id,order_no,merchant_order_id,expected_amount,crypto_chain,crypto_amount,status")
          .not("crypto_chain", "is", null).in("status", ["pending", "expired", "review"]).order("created_at", { ascending: false }).limit(100),
      ) as OpenOrder[];
      return { settings, transfers, open };
    },
    [],
    { refreshMs: 15000 },
  );

  return (
    <Screen loading={loading} error={error} hasData={!!data}>
      <PageHeader
        title="Crypto (USDT)"
        description="Customers pay USDT to your own address. PayTrace watches the blockchain and pays the order when the exact amount arrives. No phone is needed."
      />
      {data ? <Body settings={data.settings} transfers={data.transfers} open={data.open} onChanged={refresh} /> : null}
    </Screen>
  );
}

function Body({ settings, transfers, open, onChanged }: { settings: Settings; transfers: Transfer[]; open: OpenOrder[]; onChanged: () => void }) {
  const [rate, setRate] = useState(settings.taka_per_usdt?.toString() ?? "");
  const [minutes, setMinutes] = useState(String(settings.order_minutes));
  const [bepOn, setBepOn] = useState(settings.bep20_enabled);
  const [bep, setBep] = useState(settings.bep20_address ?? "");
  const [trcOn, setTrcOn] = useState(settings.trc20_enabled);
  const [trc, setTrc] = useState(settings.trc20_address ?? "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const waiting = transfers.filter((t) => t.status === "review" || t.status === "new");
  const paid = transfers.filter((t) => t.status === "matched");

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote("");
    const { error } = await sb.rpc("set_crypto_settings", {
      p_taka_per_usdt: rate.trim() === "" ? null : Number(rate),
      p_order_minutes: Number(minutes),
      p_bep20_enabled: bepOn,
      p_bep20_address: bep.trim() || null,
      p_trc20_enabled: trcOn,
      p_trc20_address: trc.trim() || null,
    });
    setBusy(false);
    if (error) return setNote(error.message);
    setNote("Saved. Websites can now create USDT deposits on the networks you switched on.");
    onChanged();
  }

  return (
    <div className="grid gap-6">
      <div className={STAT_GRID}>
        <StatCard tone="green" label="Paid by USDT" value={String(paid.length)} sub="transfers matched to orders (last 100)" icon={Coins} />
        <StatCard tone={waiting.length ? "amber" : undefined} label="Need you" value={String(waiting.length)} sub="transfers that matched no order" />
        <StatCard label="Open orders" value={String(open.filter((o) => o.status === "pending").length)} sub="waiting for a transfer" />
        <StatCard label="Rate" value={settings.taka_per_usdt ? `Tk ${settings.taka_per_usdt}` : "not set"} sub="for 1 USDT" />
      </div>

      <Card className="grid gap-4 p-5">
        <h3 className="text-base font-semibold">Settings</h3>
        <form onSubmit={save} className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Taka for 1 USDT</span>
              <Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="for example 125" aria-label="Taka for 1 USDT" />
              <span className="text-xs text-muted-foreground">PayTrace uses this to turn the taka amount into USDT. Change it any time; open orders keep the rate they were made with.</span>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Time to pay (minutes)</span>
              <Input inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-label="Minutes to pay" />
              <span className="text-xs text-muted-foreground">10 to 120. A payment made in time is still counted if the blockchain shows it a little later.</span>
            </label>
          </div>

          {(
            [
              ["bep20", "BNB Smart Chain (BEP20)", bepOn, setBepOn, bep, setBep, "0x…", settings.bep20_checked_at, settings.bep20_error],
              ["trc20", "TRON (TRC20)", trcOn, setTrcOn, trc, setTrc, "T…", settings.trc20_checked_at, settings.trc20_error],
            ] as const
          ).map(([id, label, on, setOn, addr, setAddr, ph, checked, err]) => (
            <div key={id} className="grid gap-2 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{label}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {on ? "On" : "Off"}
                  <Switch checked={on} onCheckedChange={setOn} aria-label={`${label} deposits`} />
                </span>
              </div>
              <Input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder={`Your receiving address, ${ph}`} aria-label={`${label} address`} className="font-mono text-xs" spellCheck={false} autoComplete="off" />
              {on && settings[`${id}_address` as "bep20_address" | "trc20_address"] ? (
                <p className={`text-xs ${err ? "text-destructive" : "text-muted-foreground"}`}>
                  {err ? `Problem: ${err}. ` : ""}Last checked {ago(checked)}.
                </p>
              ) : null}
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Enter only PUBLIC addresses. Never type a seed phrase or private key anywhere in PayTrace. Customers must send exactly the amount shown on their payment page, on the right network.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save settings"}</Button>
            {note ? <span role="status" className="text-sm text-muted-foreground">{note}</span> : null}
          </div>
        </form>
      </Card>

      <section>
        <h3 className="mb-2 text-base font-semibold">Transfers</h3>
        <p className="mb-3 max-w-3xl text-sm text-muted-foreground">
          Every USDT transfer to your addresses. A transfer pays an order only when its amount is exactly the amount that order asked for. Anything else waits here for you.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time (BD)</TableHead>
              <TableHead>Network</TableHead>
              <TableHead>USDT</TableHead>
              <TableHead>From</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transfers.length === 0 ? <EmptyRow cols={6} text="No transfers yet." /> : null}
            {transfers.map((t) => (
              <TransferRow key={t.id} t={t} orders={open.filter((o) => o.crypto_chain === t.chain)} onChanged={onChanged} />
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function TransferRow({ t, orders, onChanged }: { t: Transfer; orders: OpenOrder[]; onChanged: () => void }) {
  const [pick, setPick] = useState("");
  const [problem, setProblem] = useState("");
  const settled = t.status === "matched" || t.status === "ignored";

  async function match() {
    const { error } = await sb.rpc("crypto_manual_match", { p_transfer: t.id, p_order: pick });
    if (error) return setProblem(error.message);
    setProblem("");
    onChanged();
  }
  async function ignore() {
    const { error } = await sb.rpc("crypto_ignore_transfer", { p_transfer: t.id });
    if (error) return setProblem(error.message);
    setProblem("");
    onChanged();
  }

  return (
    <TableRow>
      <TableCell>{when(t.block_time)}</TableCell>
      <TableCell>{PROVIDER_LABEL[`usdt_${t.chain}`]}</TableCell>
      <TableCell className="tabular-nums">{usdt(t.amount)}</TableCell>
      <TableCell className="font-mono text-xs">
        <span className="inline-flex items-center gap-1">{short(t.from_address)}<CopyButton text={t.tx_hash} label="Tx" size="sm" variant="ghost" /></span>
      </TableCell>
      <TableCell>
        <StatusBadge status={t.status} />
        {t.review_reason ? <div className="mt-1 text-xs text-muted-foreground">{t.review_reason}</div> : null}
      </TableCell>
      <TableCell>
        {settled ? null : (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={pick} onValueChange={setPick}>
              <SelectTrigger aria-label="Order to pay with this transfer" className="h-8 w-56 text-xs"><SelectValue placeholder="Pay which order?" /></SelectTrigger>
              <SelectContent>
                {orders.length === 0 ? <SelectItem value="none" disabled>No open order on this network</SelectItem> : null}
                {orders.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.merchant_order_id ?? o.order_no} · {usdt(o.crypto_amount)} USDT · {o.status}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Confirm title="Pay this order with the transfer?" description="The order is marked paid and its website is told. Do this only if you are sure this transfer is that customer's payment." confirmLabel="Mark paid" onConfirm={match} disabled={!pick}>
              <Button size="sm" disabled={!pick}>Pay order</Button>
            </Confirm>
            <Confirm title="Set this transfer aside?" description="It stays in the list as ignored. Use it for transfers that are not customer payments." confirmLabel="Ignore" onConfirm={ignore}>
              <Button size="sm" variant="ghost">Ignore</Button>
            </Confirm>
          </div>
        )}
        {problem ? <p className="mt-1 text-xs text-destructive">{problem}</p> : null}
      </TableCell>
    </TableRow>
  );
}
