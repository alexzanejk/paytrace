import { useState } from "react";
import { must, sb } from "@/lib/supabase";
import { tk, when } from "@/lib/format";
import { reviewReasonText } from "@/lib/reasons";
import { type Order, type Payment } from "@/lib/types";
import { PAGE_INTRO, PAYMENT_STATUS } from "@/lib/words";
import { openHelp } from "@/lib/nav";
import { nudgePhone } from "@/lib/wake";
import { walletCheckLine, type PaymentCheck } from "@/lib/walletCheck";
import { useDevices } from "@/hooks/useDevices";
import { DeviceChip } from "@/components/DeviceChip";
import { ProviderChip } from "@/components/ProviderChip";
import { useQuery } from "@/hooks/useQuery";
import { Screen } from "@/components/Screen";
import { StatusBadge } from "@/components/StatusBadge";
import { PageHeader } from "@/components/PageHeader";
import { PageIntro } from "@/components/PageIntro";
import { CircleCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Confirm } from "@/components/Confirm";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Needs a decision. Two groups, kept apart on purpose (owner 2026-11-03: the team could not tell what was a problem):
 *
 *  1. "Needs a decision" (status review): arrived, did not match, a PERSON must credit or ignore it.
 *  2. "Received, no order" (status unmatched): arrived, nothing was waiting for it. NOT a problem. Listed below only so it
 *     can be matched by hand if an order turns up later.
 *
 *  Everything a card shows is worded for someone who has never seen the database. */
export function Review() {
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [showNoOrder, setShowNoOrder] = useState(false);
  const devices = useDevices();

  const { data, error, loading, refresh } = useQuery(
    async () => {
      const payments = must(
        await sb
          .from("payments")
          .select("*")
          .in("status", ["review", "unmatched"])
          .order("received_at", { ascending: false })
          .limit(100),
      ) as Payment[];
      // What the phone itself said about each held payment (migration 053): newest first per payment.
      const heldIds = payments.filter((p) => p.status === "review").map((p) => p.id);
      const checks = heldIds.length
        ? ((await sb.from("payment_checks").select("*").in("payment_id", heldIds).order("created_at", { ascending: false }).limit(300)).data ?? []) as PaymentCheck[]
        : [];
      const open = must(
        await sb
          .from("orders")
          .select("id,order_no,expected_amount,customer_name,status,wallet_method,claimed_trx_id,claimed_provider,expires_at")
          .in("status", ["pending", "review"])
          .order("created_at", { ascending: false })
          .limit(100),
      ) as Order[];
      // Orders that ran out of time in the last 48 h while a TrxID was typed: a late SMS can still pay them (migration 052).
      const since = new Date(Date.now() - 48 * 3600_000).toISOString();
      const expired = must(
        await sb
          .from("orders")
          .select("id,order_no,expected_amount,customer_name,status,wallet_method,claimed_trx_id,claimed_provider,expires_at")
          .eq("status", "expired")
          .not("claimed_trx_id", "is", null)
          .gte("expires_at", since)
          .order("expires_at", { ascending: false })
          .limit(100),
      ) as Order[];
      // Their payments, when the SMS did arrive: receipts (tracked_only) or unmatched money that nobody can see otherwise.
      const trx = expired.map((o) => o.claimed_trx_id).filter((t): t is string => !!t);
      const late = trx.length
        ? (must(await sb.from("payments").select("*").in("trx_id", trx).in("status", ["tracked_only", "unmatched"]).limit(100)) as Payment[])
        : [];
      return { payments, orders: [...open, ...expired], late, checks };
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

  const all = data?.payments ?? [];
  const orders = data?.orders ?? [];
  const decide = all.filter((p) => p.status === "review");
  // A late payment for an expired order is listed in its own group, not under "no order".
  const lateIds = new Set((data?.late ?? []).map((p) => p.id));
  const noOrder = all.filter((p) => p.status === "unmatched" && !lateIds.has(p.id));
  const late = data?.late ?? [];
  const checksOf = (p: Payment) => (data?.checks ?? []).filter((c) => c.payment_id === p.id);
  async function recheck(p: Payment) {
    const { data: r, error } = await sb.rpc("recheck_payment", { p_payment: p.id });
    if (error) return setFailed((f) => ({ ...f, [p.id]: error.message }));
    const out = r as { error?: string; device_id?: string } | null;
    if (out?.error) return setFailed((f) => ({ ...f, [p.id]: walletCheckLine(null, out.error) ?? String(out.error) }));
    if (out?.device_id) nudgePhone(out.device_id);
    setFailed((f) => ({ ...f, [p.id]: "" }));
    refresh();
  }
  const expiredOrderOf = (p: Payment) => orders.find((o) => o.status === "expired" && o.claimed_trx_id === p.trx_id && o.claimed_provider === p.provider) ?? null;

  const card = (p: Payment) => {
    const choice = picked[p.id] ?? expiredOrderOf(p)?.id ?? "";
    const order = orders.find((o) => o.id === choice);
    // A held Cash Out receipt can only pay a deposit that asked for Cash Out (the database refuses the rest).
    const choices = p.txn_type === "cash_out" ? orders.filter((o) => o.wallet_method === "cash_out") : orders;
    const why = reviewReasonText(p.review_reason);
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
          <dt className="text-muted-foreground">Receipt no. (TrxID)</dt>
          <dd className="font-mono text-xs leading-5">{p.trx_id}</dd>
          <dt className="text-muted-foreground">Arrived on phone</dt>
          <dd className="min-w-0"><DeviceChip id={p.device_id} name={devices.nameOf(p.device_id)} /></dd>
          <dt className="text-muted-foreground">Sent from</dt>
          <dd>{p.counterparty ?? "–"}</dd>
        </dl>

        <div className="rounded-lg bg-muted/60 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={p.status} />
            <span className="font-medium">{p.status === "review" ? "Why it is held:" : lateIds.has(p.id) ? "The order had already run out of time." : "Nothing was waiting for it."}</span>
          </div>
          <p className="mt-1 text-muted-foreground">
            {p.status === "review"
              ? (why ?? "It did not match any order exactly.")
              : lateIds.has(p.id)
                ? `The customer typed this TrxID on order ${expiredOrderOf(p)?.order_no ?? ""}, which expired before the SMS arrived. If the money is real, credit it: the website is then told the deposit was paid.`
                : "The money is yours and is counted in the totals. Match it only if you know which order it was for."}
          </p>
          {p.status === "review" && p.review_reason === "balance_chain_mismatch" ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
              <span className="text-xs text-muted-foreground">{walletCheckLine(checksOf(p)[0] ?? null) ?? "PayTrace can ask the phone to prove this payment with the wallet's live balance and statement."}</span>
              {checksOf(p)[0]?.status !== "queued" ? (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void recheck(p)} title="The phone reads the wallet's live balance, then its statement. A match releases and credits this payment by itself.">
                  Check with the wallet
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="mt-auto flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:flex-wrap sm:items-center">
          <Select value={choice} onValueChange={(v) => setPicked((s) => ({ ...s, [p.id]: v }))}>
            <SelectTrigger className="w-full sm:w-64" aria-label={`Order for ${p.trx_id}`}>
              <SelectValue placeholder="Which order was this for?" />
            </SelectTrigger>
            <SelectContent>
              {choices.length === 0 ? (
                <SelectItem value="none" disabled>
                  No open orders right now
                </SelectItem>
              ) : (
                choices.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.order_no} · {tk(o.expected_amount)}
                    {o.customer_name ? ` · ${o.customer_name}` : ""}
                    {o.status === "expired" ? " · expired, TrxID typed" : ""}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Confirm
              title="Credit this payment to the order?"
              description={`${tk(p.amount)} (receipt ${p.trx_id}) will be credited to ${order?.order_no ?? "the chosen order"} and the order will turn Paid.${
                order && Number(order.expected_amount) !== Number(p.amount) ? ` The order asked for ${tk(order.expected_amount)}: the website will be told ${tk(p.amount)} was paid.` : ""
              } This cannot be undone.`}
              confirmLabel="Credit it"
              disabled={!choice || choice === "none"}
              onConfirm={() => act(p.id, () => sb.rpc("manual_match", { p_payment_id: p.id, p_order_id: choice }))}
            >
              <Button size="sm" disabled={!choice || choice === "none"} title="Credit this money to the order you picked">
                Credit to order
              </Button>
            </Confirm>
            {p.status === "review" ? (
              <Confirm
                title="Ignore this payment?"
                description="It will never be credited to any order and will not count in the totals. The SMS stays on the Transactions page, marked Ignored, and Admin Hub shows it as UNVERIFIED."
                confirmLabel="Ignore it"
                onConfirm={() => act(p.id, () => sb.rpc("ignore_payment", { p_payment_id: p.id }))}
              >
                <Button size="sm" variant="outline" title="This money belongs to no order">
                  Ignore
                </Button>
              </Confirm>
            ) : null}
          </div>
          {failed[p.id] ? <span className="text-xs text-destructive">{failed[p.id]}</span> : null}
        </div>
      </Card>
    );
  };

  return (
    <Screen loading={loading} error={error} hasData={!!data}>
      <PageHeader title="Review" description={decide.length === 0 ? "Payments held for review." : `${decide.length} held for review, waiting for you. Admin Hub shows each as HELD FOR REVIEW until you decide.`} />
      <PageIntro id="review" intro={PAGE_INTRO.review} onHelp={openHelp} />

      {decide.length === 0 ? (
        <Card className="p-8 text-center">
          <CircleCheck className="mx-auto mb-2 h-6 w-6 text-status-ok" aria-hidden />
          <p className="font-medium">Nothing is held for review</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            When a payment arrives that does not match any order, it appears here and you are messaged on Telegram.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">{decide.map(card)}</div>
      )}

      {late.length > 0 ? (
        <section className="mt-8">
          <div className="mb-3">
            <h3 className="text-base font-semibold">
              Paid after the order expired <span className="text-muted-foreground">({late.length})</span>
            </h3>
            <p className="text-sm text-muted-foreground">
              The SMS came after the order's time was up. The order is picked for you; press Credit to order if the payment is real.
            </p>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">{late.map(card)}</div>
        </section>
      ) : null}

      {noOrder.length > 0 ? (
        <section className="mt-8">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold">
                Received, no order <span className="text-muted-foreground">({noOrder.length})</span>
              </h3>
              <p className="text-sm text-muted-foreground" title={PAYMENT_STATUS.unmatched.meaning}>
                Not a problem. Money that arrived when no order was waiting. It is already counted; match one only if you know its order.
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setShowNoOrder((v) => !v)} aria-expanded={showNoOrder}>
              {showNoOrder ? "Hide" : "Show"}
            </Button>
          </div>
          {showNoOrder ? <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">{noOrder.map(card)}</div> : null}
        </section>
      ) : null}
    </Screen>
  );
}
