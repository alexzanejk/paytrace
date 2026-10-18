import { useState } from "react";
import { must, sb } from "@/lib/supabase";
import { tk, when } from "@/lib/format";
import { reviewReasonText } from "@/lib/reasons";
import { type Order, type Payment } from "@/lib/types";
import { useDevices } from "@/hooks/useDevices";
import { DeviceChip } from "@/components/DeviceChip";
import { ProviderChip } from "@/components/ProviderChip";
import { useQuery } from "@/hooks/useQuery";
import { Screen } from "@/components/Screen";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyRow } from "@/components/Empty";
import { Confirm } from "@/components/Confirm";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function Review() {
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const devices = useDevices();

  const { data, error, loading, refresh } = useQuery(
    async () => {
      const payments = must(
        await sb
          .from("payments")
          .select("*")
          .in("status", ["review", "unmatched"])
          .neq("txn_type", "cash_out")
          .order("received_at", { ascending: false })
          .limit(100),
      ) as Payment[];
      const orders = must(
        await sb
          .from("orders")
          .select("id,order_no,expected_amount,customer_name,status")
          .in("status", ["pending", "review"])
          .order("created_at", { ascending: false })
          .limit(100),
      ) as Order[];
      return { payments, orders };
    },
    [],
    { refreshMs: 20000 },
  );

  async function act(paymentId: string, fn: () => PromiseLike<{ error: { message: string } | null }>) {
    const { error } = await fn();
    if (error) setFailed((f) => ({ ...f, [paymentId]: error.message }));
    else {
      setFailed((f) => ({ ...f, [paymentId]: "" }));
      refresh();
    }
  }

  const payments = data?.payments ?? [];
  const orders = data?.orders ?? [];

  return (
    <Screen loading={loading} error={error} hasData={!!data}>
      <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
        Payments held for a person to decide: wrong amount, a different payer number, an expired order, or a format the
        system does not fully trust yet. Nothing here has been credited.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time (BD)</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Provider</TableHead>
            <TableHead>TrxID</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>From</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.length === 0 ? (
            <EmptyRow cols={8} text="Nothing is waiting for a decision." />
          ) : (
            payments.map((p) => {
              const choice = picked[p.id] ?? "";
              const order = orders.find((o) => o.id === choice);
              return (
                <TableRow key={p.id}>
                  <TableCell>{when(p.occurred_at ?? p.received_at)}</TableCell>
                  <TableCell className="max-w-40"><DeviceChip id={p.device_id} name={devices.nameOf(p.device_id)} /></TableCell>
                  <TableCell><ProviderChip provider={p.provider} /></TableCell>
                  <TableCell className="font-mono text-xs">{p.trx_id}</TableCell>
                  <TableCell className="text-right">{tk(p.amount)}</TableCell>
                  <TableCell>{p.counterparty ?? "–"}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <StatusBadge status={p.status} />
                      {p.review_reason ? (
                        <span className="max-w-56 whitespace-normal text-xs text-muted-foreground">
                          {reviewReasonText(p.review_reason)}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select value={choice} onValueChange={(v) => setPicked((s) => ({ ...s, [p.id]: v }))}>
                        <SelectTrigger className="h-8 w-56 text-xs" aria-label={`Order for ${p.trx_id}`}>
                          <SelectValue placeholder="Match to order…" />
                        </SelectTrigger>
                        <SelectContent>
                          {orders.length === 0 ? (
                            <SelectItem value="none" disabled>
                              No open orders
                            </SelectItem>
                          ) : (
                            orders.map((o) => (
                              <SelectItem key={o.id} value={o.id}>
                                {o.order_no} · {tk(o.expected_amount)}
                                {o.customer_name ? ` · ${o.customer_name}` : ""}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      <Confirm
                        title="Credit this payment to the order?"
                        description={`${p.trx_id} (${tk(p.amount)}) will be credited to ${
                          order?.order_no ?? "the chosen order"
                        }. This cannot be undone.`}
                        confirmLabel="Credit it"
                        disabled={!choice || choice === "none"}
                        onConfirm={() =>
                          act(p.id, () => sb.rpc("manual_match", { p_payment_id: p.id, p_order_id: choice }))
                        }
                      >
                        <Button size="sm" disabled={!choice || choice === "none"}>
                          Match
                        </Button>
                      </Confirm>
                      <Confirm
                        title="Ignore this payment?"
                        description="It will never be credited to an order. The record stays in the Payments list."
                        confirmLabel="Ignore it"
                        onConfirm={() => act(p.id, () => sb.rpc("ignore_payment", { p_payment_id: p.id }))}
                      >
                        <Button size="sm" variant="outline">
                          Ignore
                        </Button>
                      </Confirm>
                      {failed[p.id] ? <span className="text-xs text-destructive">{failed[p.id]}</span> : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </Screen>
  );
}
