import { useMemo, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { must, sb } from "@/lib/supabase";
import { tk, when } from "@/lib/format";
import { PROVIDER_LABEL, type Order, type Settings } from "@/lib/types";
import { ORDER_STATUS, PAGE_INTRO } from "@/lib/words";
import { openHelp } from "@/lib/nav";
import { useQuery } from "@/hooks/useQuery";
import { PageHeader } from "@/components/PageHeader";
import { PageIntro } from "@/components/PageIntro";
import { Screen } from "@/components/Screen";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyRow } from "@/components/Empty";
import { Confirm } from "@/components/Confirm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

function newOrderNo() {
  return (
    "ORD-" +
    Date.now().toString(36).toUpperCase().slice(-6) +
    Math.floor(Math.random() * 36)
      .toString(36)
      .toUpperCase()
  );
}

/** The status a person sees. An open order past its time is "Not paid in time" even before the server marks it. */
const shownStatus = (o: Order, now: number) => (o.status === "pending" && new Date(o.expires_at).getTime() < now ? "expired" : o.status);

/** The order of the filter chips: what needs you first, the boring bulk last. */
const CHIPS = ["pending", "review", "paid", "expired", "cancelled"] as const;
type Chip = (typeof CHIPS)[number] | "all";

/** Orders (owner 2026-11-03: make it understandable). What changed for that: plain status words, a count per status
 *  with one click to filter, "Not paid in time" hidden by default (hundreds of abandoned website deposits buried the
 *  few that matter), the website named instead of a key id, "Paid with" instead of "Claimed TrxID", and the typing
 *  form folded behind a button so the list comes first. */
export function Orders({ settings }: { settings: Settings | null }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [chip, setChip] = useState<Chip>("all");

  const { data, error, loading, refresh } = useQuery(
    async () => {
      const orders = must(await sb.from("orders").select("*").order("created_at", { ascending: false }).limit(300)) as Order[];
      // The website each deposit came from, by name. Only the name is read.
      const sites = must(await sb.from("api_keys").select("id,name")) as { id: string; name: string }[];
      return { orders, sites: Object.fromEntries(sites.map((s) => [s.id, s.name])) as Record<string, string> };
    },
    [],
    { refreshMs: 20000 },
  );

  async function create(e: FormEvent) {
    e.preventDefault();
    const value = parseFloat(amount.replace(/,/g, ""));
    if (!(value > 0)) return setNote("Enter a valid amount.");
    setBusy(true);
    const minutes = settings?.order_expiry_minutes || 60;
    const { error } = await sb.from("orders").insert({
      order_no: newOrderNo(),
      customer_name: name.trim() || null,
      customer_phone: phone.trim() || null,
      expected_amount: value,
      expires_at: new Date(Date.now() + minutes * 60000).toISOString(),
    });
    setBusy(false);
    if (error) return setNote(error.message);
    setName("");
    setPhone("");
    setAmount("");
    setNote(`Order created. It waits ${minutes} minutes for a payment of ${tk(value)}.`);
    refresh();
  }

  const now = Date.now();
  const all = data?.orders ?? [];
  const sites = data?.sites ?? {};
  const counts = useMemo(() => {
    const c: Record<string, number> = { pending: 0, review: 0, paid: 0, expired: 0, cancelled: 0 };
    for (const o of all) c[shownStatus(o, now)] = (c[shownStatus(o, now)] ?? 0) + 1;
    return c;
  }, [all, now]);
  // "All" still leaves out the abandoned ones: they are the one group nobody needs to scroll past.
  const orders = all.filter((o) => (chip === "all" ? shownStatus(o, now) !== "expired" : shownStatus(o, now) === chip));

  const sourceOf = (o: Order) =>
    o.kind === "deposit" ? (
      <>
        <span className="font-medium">{(o.api_key_id && sites[o.api_key_id]) || "A site"}</span>
        <span className="block text-muted-foreground">
          {o.provider ? `${PROVIDER_LABEL[o.provider] ?? o.provider}${o.wallet_number ? ` · to ${o.wallet_number}` : ""}` : "wallet not chosen yet"}
          {o.merchant_order_id ? ` · their ref ${o.merchant_order_id}` : ""}
        </span>
      </>
    ) : (
      <span className="font-medium">Typed in here</span>
    );

  const paidWith = (o: Order) =>
    o.claimed_trx_id ? (
      <span className="font-mono text-xs" title="The wallet's receipt number of the payment that was credited to this order">
        {PROVIDER_LABEL[o.claimed_provider ?? ""] ?? o.claimed_provider} {o.claimed_trx_id}
      </span>
    ) : (
      <span className="text-muted-foreground">–</span>
    );

  const cancelOf = (o: Order) =>
    ["pending", "review"].includes(o.status) ? (
      <Confirm
        title="Cancel this order?"
        description={`${o.order_no} will no longer accept a payment. If the customer pays anyway, the money goes to Needs a decision.`}
        confirmLabel="Cancel order"
        onConfirm={async () => {
          const { error } = await sb.rpc("cancel_order", { p_order: o.id });
          if (error) setNote(error.message);
          refresh();
        }}
      >
        <Button size="sm" variant="outline">
          Cancel
        </Button>
      </Confirm>
    ) : null;

  const chipButton = (c: Chip, label: string, n: number | null) => (
    <button
      key={c}
      type="button"
      onClick={() => setChip(c)}
      aria-pressed={chip === c}
      className={cn(
        "rounded-full border px-3 py-1 text-sm transition-colors",
        chip === c ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
      title={c === "all" ? "Everything except Expired" : ORDER_STATUS[c]?.meaning}
    >
      {label}
      {n != null ? <span className={cn("ml-1.5 tabular", chip === c ? "opacity-80" : "")}>{n}</span> : null}
    </button>
  );

  return (
    <Screen loading={loading} error={error} hasData={!!data}>
      <PageHeader
        title="Deposit orders"
        description="Money that is expected. Each order waits for a payment of its amount."
        actions={
          <Button size="sm" variant={adding ? "outline" : "default"} onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
            <Plus aria-hidden /> {adding ? "Close" : "Type in an order"}
          </Button>
        }
      />
      <PageIntro id="orders" intro={PAGE_INTRO.orders} onHelp={openHelp} />

      {adding ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Type in an order</CardTitle>
            <p className="text-sm text-muted-foreground">
              For a payment you are expecting outside your websites. It waits {settings?.order_expiry_minutes || 60} minutes; a payment of
              exactly this amount is then credited to it by itself.
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={create} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="o-name">Customer name (optional)</Label>
                <Input id="o-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="o-phone">Customer phone (optional)</Label>
                <Input id="o-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="o-amount">Amount (Tk)</Label>
                <Input id="o-amount" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={busy} className="w-full sm:w-auto">
                  {busy ? "Creating…" : "Create order"}
                </Button>
              </div>
              {note ? <p className="text-sm text-muted-foreground sm:col-span-2 lg:col-span-4">{note}</p> : null}
            </form>
          </CardContent>
        </Card>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Show which orders">
        {chipButton("all", "Waiting and paid", null)}
        {CHIPS.map((c) => chipButton(c, ORDER_STATUS[c].label, counts[c] ?? 0))}
      </div>

      <div className="hidden xl:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order no.</TableHead>
              <TableHead>Created (BD)</TableHead>
              <TableHead>Where from</TableHead>
              <TableHead>Player / customer</TableHead>
              <TableHead className="text-right">Amount expected</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Paid with</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.length === 0 ? (
              <EmptyRow cols={8} text={chip === "all" ? "No waiting or paid orders. Abandoned ones are under \"Expired\"." : `No orders with status "${ORDER_STATUS[chip]?.label ?? chip}".`} />
            ) : (
              orders.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-mono text-xs">{o.order_no}</TableCell>
                  <TableCell>{when(o.created_at)}</TableCell>
                  <TableCell className="text-xs">{sourceOf(o)}</TableCell>
                  <TableCell>
                    {o.customer_name ?? <span className="text-muted-foreground">–</span>}
                    {o.customer_phone ? <span className="block text-xs text-muted-foreground">{o.customer_phone}</span> : null}
                  </TableCell>
                  <TableCell className="text-right tabular">{tk(o.expected_amount)}</TableCell>
                  <TableCell><StatusBadge kind="order" status={shownStatus(o, now)} /></TableCell>
                  <TableCell>{paidWith(o)}</TableCell>
                  <TableCell>{cancelOf(o)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-3 xl:hidden">
        {orders.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">
            {chip === "all" ? "No waiting or paid orders. Abandoned ones are under \"Expired\"." : `No orders with status "${ORDER_STATUS[chip]?.label ?? chip}".`}
          </p>
        ) : null}
        {orders.map((o) => (
          <Card key={o.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-xs">{o.order_no}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{when(o.created_at)}</p>
              </div>
              <p className="whitespace-nowrap text-lg font-semibold tabular">{tk(o.expected_amount)}</p>
            </div>
            <div className="mt-2 text-sm">
              {o.customer_name ?? "–"}
              {o.customer_phone ? <span className="text-muted-foreground"> · {o.customer_phone}</span> : null}
            </div>
            <div className="mt-1 text-xs">{sourceOf(o)}</div>
            {o.claimed_trx_id ? <p className="mt-1 text-xs text-muted-foreground">Paid with {paidWith(o)}</p> : null}
            <div className="mt-3 flex items-center justify-between gap-2">
              <StatusBadge kind="order" status={shownStatus(o, now)} />
              {cancelOf(o)}
            </div>
          </Card>
        ))}
      </div>
    </Screen>
  );
}
