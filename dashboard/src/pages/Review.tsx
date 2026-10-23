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
import { PageHeader } from "@/components/PageHeader";
import { CircleCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Confirm } from "@/components/Confirm";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
      <PageHeader
        title="Review"
        description="Payments held for a person to decide: wrong amount, a different payer number, an expired order, or a format the system does not fully trust yet. Nothing here has been credited."
      />
      {payments.length === 0 ? (
        <Card className="p-8 text-center">
          <CircleCheck className="mx-auto mb-2 h-6 w-6 text-status-ok" aria-hidden />
          <p className="font-medium">Nothing is waiting for a decision</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Held payments appear here, and you are messaged on Telegram when one does.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">
          {payments.map((p) => {
            const choice = picked[p.id] ?? "";
            const order = orders.find((o) => o.id === choice);
            return (
              <Card key={p.id} className="flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <ProviderChip provider={p.provider} className="font-medium" />
                    <p className="mt-0.5 text-xs text-muted-foreground">{when(p.occurred_at ?? p.received_at)}</p>
                  </div>
                  <p className="whitespace-nowrap text-xl font-semibold tabular">{tk(p.amount)}</p>
                </div>

                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">TrxID</dt>
                  <dd className="font-mono text-xs leading-5">{p.trx_id}</dd>
                  <dt className="text-muted-foreground">Phone</dt>
                  <dd className="min-w-0"><DeviceChip id={p.device_id} name={devices.nameOf(p.device_id)} /></dd>
                  <dt className="text-muted-foreground">From</dt>
                  <dd>{p.counterparty ?? "–"}</dd>
                </dl>

                <div className="flex flex-wrap items-start gap-2">
                  <StatusBadge status={p.status} />
                  {p.review_reason ? <p className="min-w-0 flex-1 text-sm text-muted-foreground">{reviewReasonText(p.review_reason)}</p> : null}
                </div>

                <div className="mt-auto flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:flex-wrap sm:items-center">
                  <Select value={choice} onValueChange={(v) => setPicked((s) => ({ ...s, [p.id]: v }))}>
                    <SelectTrigger className="w-full sm:w-64" aria-label={`Order for ${p.trx_id}`}>
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
                  <div className="flex items-center gap-2">
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
                  </div>
                  {failed[p.id] ? <span className="text-xs text-destructive">{failed[p.id]}</span> : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </Screen>
  );
}
