import { useState, type FormEvent } from "react";
import { must, sb } from "@/lib/supabase";
import { tk, when } from "@/lib/format";
import { PROVIDER_LABEL, type Order, type Settings } from "@/lib/types";
import { useQuery } from "@/hooks/useQuery";
import { PageHeader } from "@/components/PageHeader";
import { Screen } from "@/components/Screen";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyRow } from "@/components/Empty";
import { Confirm } from "@/components/Confirm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function newOrderNo() {
  return (
    "ORD-" +
    Date.now().toString(36).toUpperCase().slice(-6) +
    Math.floor(Math.random() * 36)
      .toString(36)
      .toUpperCase()
  );
}

export function Orders({ settings }: { settings: Settings | null }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, error, loading, refresh } = useQuery(
    async () => must(await sb.from("orders").select("*").order("created_at", { ascending: false }).limit(200)) as Order[],
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
    setNote("Order created.");
    refresh();
  }

  const orders = data ?? [];

  const sourceOf = (o: Order) =>
    o.kind === "deposit" ? (
      <>
        <span className="font-medium">Website deposit</span>
        <span className="block text-muted-foreground">
          {o.merchant_order_id ?? "–"}
          {o.provider ? ` · ${PROVIDER_LABEL[o.provider] ?? o.provider} ${o.wallet_number ?? ""}` : " · wallet not chosen"}
        </span>
      </>
    ) : (
      "Entered here"
    );

  const cancelOf = (o: Order) =>
    ["pending", "review"].includes(o.status) ? (
      <Confirm
        title="Cancel this order?"
        description={`${o.order_no} will no longer accept a payment.`}
        confirmLabel="Cancel order"
        onConfirm={async () => {
          await sb.from("orders").update({ status: "cancelled" }).eq("id", o.id).in("status", ["pending", "review"]);
          refresh();
        }}
      >
        <Button size="sm" variant="outline">
          Cancel
        </Button>
      </Confirm>
    ) : null;

  return (
    <Screen loading={loading} error={error} hasData={!!data}>
      <PageHeader title="Orders" description="Orders you enter here, and deposits created by your websites. A payment is credited to an order only when it matches." />
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>New order</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="o-name">Customer name</Label>
              <Input id="o-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="o-phone">Customer phone</Label>
              <Input id="o-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="o-amount">Amount (Tk)</Label>
              <Input
                id="o-amount"
                inputMode="decimal"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
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

      <div className="hidden xl:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Created (BD)</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Claimed TrxID</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.length === 0 ? (
              <EmptyRow cols={9} text="No orders yet." />
            ) : (
              orders.map((o) => {
                const expired = o.status === "pending" && new Date(o.expires_at) < new Date();
                return (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono text-xs">{o.order_no}</TableCell>
                    <TableCell>{when(o.created_at)}</TableCell>
                    <TableCell className="text-xs">{sourceOf(o)}</TableCell>
                    <TableCell>{o.customer_name ?? "–"}</TableCell>
                    <TableCell>{o.customer_phone ?? "–"}</TableCell>
                    <TableCell className="text-right">{tk(o.expected_amount)}</TableCell>
                    <TableCell>
                      <StatusBadge status={expired ? "expired" : o.status} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {o.claimed_trx_id
                        ? `${PROVIDER_LABEL[o.claimed_provider ?? ""] ?? o.claimed_provider} ${o.claimed_trx_id}`
                        : "–"}
                    </TableCell>
                    <TableCell>{cancelOf(o)}</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-3 xl:hidden">
        {orders.length === 0 ? <p className="py-8 text-center text-muted-foreground">No orders yet.</p> : null}
        {orders.map((o) => {
          const expired = o.status === "pending" && new Date(o.expires_at) < new Date();
          return (
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
              {o.claimed_trx_id ? (
                <p className="mt-1 font-mono text-xs">
                  {PROVIDER_LABEL[o.claimed_provider ?? ""] ?? o.claimed_provider} {o.claimed_trx_id}
                </p>
              ) : null}
              <div className="mt-3 flex items-center justify-between gap-2">
                <StatusBadge status={expired ? "expired" : o.status} />
                {cancelOf(o)}
              </div>
            </Card>
          );
        })}
      </div>
    </Screen>
  );
}
