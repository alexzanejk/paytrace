import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { sb } from "@/lib/supabase";
import { tk, when } from "@/lib/format";
import { PROVIDER_LABEL, TYPE_LABEL, type DeviceWallet, type Order, type Payment } from "@/lib/types";
import { canAskWalletApp, isFullMatch, queryLine, readQuery, type SearchQuery } from "@/lib/globalSearch";
import { PAYOUT_WORDS, payoutLine, type PayoutItemRow, type PayoutRow } from "@/lib/payouts";
import { payLine, type CommissionPayRow } from "@/lib/commissionPays";
import { reviewReasonText } from "@/lib/reasons";
import { hubView } from "@/lib/words";
import { openPaymentsWith } from "@/lib/filters";
import { openPage, type TabId } from "@/lib/nav";
import { phoneHash } from "@/lib/phoneList";
import { useQuery } from "@/hooks/useQuery";
import { useDevices } from "@/hooks/useDevices";
import { PageHeader } from "@/components/PageHeader";
import { AppSearch } from "@/components/AppSearch";
import { StatusBadge } from "@/components/StatusBadge";
import { DeviceChip } from "@/components/DeviceChip";
import { ProviderChip } from "@/components/ProviderChip";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface AppRow { id: string; device_id: string; provider: string; at: string; type: string; amount: number | string; commission: number | string | null; party: string | null; trx_id: string | null }
interface SendRow { id: string; device_id: string; kind: string; provider: string | null; status: string; amount: number | null; to_number: string | null; trx_id: string | null; error: string | null; created_at: string; finished_at: string | null }

/** One part of the answer: its rows, or why it could not be read. A failed read is SAID, never shown as "nothing". */
interface Part<T> { rows: T[]; error: string }
const part = async <T,>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Part<T>> => {
  try {
    const r = await q;
    return r.error ? { rows: [], error: r.error.message } : { rows: (r.data ?? []) as T[], error: "" };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : String(e) };
  }
};
const SENDS = ["cashin", "sendmoney", "btob"];
const SEND_WORD: Record<string, string> = { cashin: "Cash In", sendmoney: "Send Money", btob: "B2B to the DSO" };
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });

async function load(q: SearchQuery) {
  const like = `%${q.text}%`;
  const byNumber = q.kind === "number";
  const [payments, appRows, orders, payouts, commission, sends, ownNumbers, sites] = await Promise.all([
    part<Payment>(byNumber
      ? sb.from("payments").select("*").in("counterparty", q.numberForms).order("received_at", { ascending: false }).limit(20)
      : sb.from("payments").select("*").ilike("trx_id", like).order("received_at", { ascending: false }).limit(20)),
    part<AppRow>(byNumber
      ? sb.from("app_rows").select("id,device_id,provider,at,type,amount,commission,party,trx_id").in("party", q.numberForms).order("at", { ascending: false }).limit(20)
      : sb.from("app_rows").select("id,device_id,provider,at,type,amount,commission,party,trx_id").ilike("trx_id", like).order("at", { ascending: false }).limit(20)),
    part<Order & { payment_id: string | null }>(byNumber
      ? sb.from("orders").select("*").in("customer_phone", [q.text, `+88${q.text}`, `88${q.text}`]).order("created_at", { ascending: false }).limit(20)
      : sb.from("orders").select("*").or(`claimed_trx_id.ilike.${like},order_no.ilike.${like},merchant_order_id.ilike.${like}`).order("created_at", { ascending: false }).limit(20)),
    part<PayoutRow>(byNumber
      ? sb.from("payouts").select("*").eq("to_number", q.text).order("created_at", { ascending: false }).limit(20)
      : sb.from("payouts").select("*").or(`trx_id.ilike.${like},for_trx.ilike.${like}`).order("created_at", { ascending: false }).limit(20)),
    part<CommissionPayRow>(byNumber
      ? sb.from("commission_pays").select("*").eq("to_number", q.text).order("created_at", { ascending: false }).limit(10)
      : sb.from("commission_pays").select("*").ilike("trx_id", like).order("created_at", { ascending: false }).limit(10)),
    part<SendRow>(byNumber
      ? sb.from("phone_commands").select("id,device_id,kind,provider,status,amount,to_number,trx_id,error,created_at,finished_at").in("kind", SENDS).eq("to_number", q.text).order("created_at", { ascending: false }).limit(20)
      : sb.from("phone_commands").select("id,device_id,kind,provider,status,amount,to_number,trx_id,error,created_at,finished_at").in("kind", SENDS).ilike("trx_id", like).order("created_at", { ascending: false }).limit(20)),
    byNumber
      ? part<DeviceWallet>(sb.from("device_wallets").select("id,device_id,provider,wallet_number,method,enabled,wallet_group").eq("wallet_number", q.text))
      : Promise.resolve<Part<DeviceWallet>>({ rows: [], error: "" }),
    part<{ id: string; name: string }>(sb.from("api_keys").select("id,name")),
  ]);

  // What hangs on the transactions found: the order each one paid, and the payout it is in.
  const ids = payments.rows.map((p) => p.id);
  const trx = payments.rows.map((p) => p.trx_id).filter(Boolean);
  if (ids.length) {
    const have = new Set(orders.rows.map((o) => o.id));
    const linked = await part<Order & { payment_id: string | null }>(sb.from("orders").select("*").in("payment_id", ids).limit(40));
    const typed = trx.length ? await part<Order & { payment_id: string | null }>(sb.from("orders").select("*").in("claimed_trx_id", trx).limit(40)) : { rows: [], error: "" };
    for (const o of [...linked.rows, ...typed.rows]) if (!have.has(o.id)) { have.add(o.id); orders.rows.push(o); }
    if (!orders.error) orders.error = linked.error || typed.error;
    const items = await part<PayoutItemRow>(sb.from("payout_items").select("payout_id,payment_id,amount,live").in("payment_id", ids).eq("live", true));
    const known = new Set(payouts.rows.map((p) => p.id));
    const missing = [...new Set(items.rows.map((i) => i.payout_id))].filter((id) => !known.has(id));
    if (missing.length) {
      const more = await part<PayoutRow>(sb.from("payouts").select("*").in("id", missing));
      payouts.rows.push(...more.rows);
      if (!payouts.error) payouts.error = more.error;
    }
    if (!payouts.error) payouts.error = items.error;
    return { payments, appRows, orders, payouts, commission, sends, ownNumbers, sites: Object.fromEntries(sites.rows.map((s) => [s.id, s.name])) as Record<string, string>, items: items.rows };
  }
  return { payments, appRows, orders, payouts, commission, sends, ownNumbers, sites: Object.fromEntries(sites.rows.map((s) => [s.id, s.name])) as Record<string, string>, items: [] as PayoutItemRow[] };
}

/** The answer to the search box at the top of every page: everything PayTrace holds about one TrxID, number or order. */
export function SearchPage({ typed }: { typed: string }) {
  const q = readQuery(typed);
  const devices = useDevices(30000);
  const { data, loading } = useQuery(async () => (q.kind === "none" ? null : load(q)), [q.kind, q.text]);

  if (q.kind === "none") {
    return (
      <>
        <PageHeader title="Search" description="Type a TrxID, a phone number or an order number in the box at the top." />
        <Card className="p-4 text-sm text-muted-foreground">{q.problem}</Card>
      </>
    );
  }

  // Wallet-list rows PayTrace already shows as a transaction (same TrxID) are not listed twice.
  const haveTrx = new Set((data?.payments.rows ?? []).map((p) => p.trx_id.toUpperCase()));
  const listOnly = (data?.appRows.rows ?? []).filter((r) => !r.trx_id || !haveTrx.has(r.trx_id.toUpperCase()));
  const found = data
    ? data.payments.rows.length + listOnly.length + data.orders.rows.length + data.payouts.rows.length + data.commission.rows.length + data.sends.rows.length + data.ownNumbers.rows.length
    : 0;
  const failed = data ? [data.payments, data.appRows, data.orders, data.payouts, data.commission, data.sends, data.ownNumbers].some((p) => p.error) : false;
  const payoutOf = (paymentId: string) => {
    const item = data?.items.find((i) => i.payment_id === paymentId);
    return item ? data?.payouts.rows.find((p) => p.id === item.payout_id) : undefined;
  };
  const maybe = (stored: string | null | undefined) =>
    q.kind === "number" && !isFullMatch(stored, q.text) ? <span className="text-xs text-status-warn">may be this number (the wallet hides the middle digits)</span> : null;

  return (
    <>
      <PageHeader title="Search" description={`${queryLine(q)}. Everything PayTrace holds about it.`} />

      {loading && !data ? <Card className="p-4 text-sm text-muted-foreground" aria-busy>Searching…</Card> : null}

      {data && found === 0 ? (
        <Card className="mb-4 flex items-start gap-3 p-4 text-sm">
          <Search className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div>
            <p className="font-medium">{failed ? "Nothing found in the parts that could be searched." : "PayTrace holds nothing for this."}</p>
            <p className="mt-1 text-muted-foreground">
              No SMS, no wallet-list entry, no order and no payout matches.
              {canAskWalletApp(q) ? " The wallet's own app can still be asked below." : ""}
            </p>
          </div>
        </Card>
      ) : null}

      {data ? (
        <div className="flex flex-col gap-5">
          {data.ownNumbers.rows.length ? (
            <Section title="Your own number" part={data.ownNumbers}>
              {data.ownNumbers.rows.map((w) => (
                <Row key={w.id}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <ProviderChip provider={w.provider} />
                    <DeviceChip id={w.device_id} name={devices.nameOf(w.device_id)} />
                    <span className="text-sm">{w.method === "cash_out" ? "Cash Out (agent)" : "Send Money"} deposit number{w.enabled ? "" : " (switched off)"}</span>
                  </div>
                  <Open onClick={() => { window.location.hash = phoneHash(w.device_id, "wallets"); }}>Open the phone</Open>
                </Row>
              ))}
            </Section>
          ) : null}

          <Section title="Transactions" part={data.payments} empty="No SMS with this.">
            {data.payments.rows.map((p) => <PaymentRow key={p.id} p={p} phone={devices.nameOf(p.device_id)} payout={payoutOf(p.id)} nameOf={devices.nameOf} note={maybe(p.counterparty)} />)}
          </Section>

          {listOnly.length || data.appRows.error ? (
            <Section title="In the wallet's own list, with no SMS" part={{ rows: listOnly, error: data.appRows.error }}>
              {listOnly.map((r) => (
                <Row key={r.id}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <ProviderChip provider={r.provider} />
                      <span className="text-sm font-medium">{r.type}</span>
                      {r.trx_id ? <span className="font-mono text-xs">{r.trx_id}</span> : null}
                      <span className="text-sm font-semibold tabular">{tk(Math.abs(Number(r.amount)))} {Number(r.amount) < 0 ? "out" : "in"}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <DeviceChip id={r.device_id} name={devices.nameOf(r.device_id)} />
                      <span>{when(r.at)}</span>
                      {r.party ? <span>{r.party}</span> : null}
                      {maybe(r.party)}
                    </div>
                  </div>
                  <Open onClick={() => openPaymentsWith({ from: dayOf(r.at), to: dayOf(r.at), device: r.device_id, search: r.trx_id ?? undefined })}>Open Transactions</Open>
                </Row>
              ))}
            </Section>
          ) : null}

          <Section title="Deposit orders" part={data.orders} empty="No order with this.">
            {data.orders.rows.map((o) => (
              <Row key={o.id}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-sm font-medium">{o.order_no}</span>
                    <StatusBadge status={o.status} kind="order" />
                    <span className="text-sm font-semibold tabular">{tk(o.expected_amount)}</span>
                    {o.provider ? <ProviderChip provider={o.provider} /> : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{o.api_key_id ? data.sites[o.api_key_id] ?? "A website" : "Typed in by hand"}</span>
                    {o.merchant_order_id ? <span>site's own number {o.merchant_order_id}</span> : null}
                    {o.claimed_trx_id ? <span>customer typed <span className="font-mono">{o.claimed_trx_id}</span></span> : <span>no TrxID typed</span>}
                    <span>{when(o.created_at)}</span>
                    {o.customer_phone ? <span>{o.customer_phone}</span> : null}
                  </div>
                </div>
                <Open onClick={() => openPage("orders")}>Open Deposit orders</Open>
              </Row>
            ))}
          </Section>

          <Section title="Payouts" part={{ rows: [...data.payouts.rows, ...data.commission.rows], error: data.payouts.error || data.commission.error }} empty="No payout with this.">
            {data.payouts.rows.map((p) => (
              <Row key={p.id}>
                <div className="min-w-0 text-sm">
                  <Badge tone={PAYOUT_WORDS[p.status].tone}>{PAYOUT_WORDS[p.status].label}</Badge> <span className="ml-1">{payoutLine(p, devices.nameOf)}</span>
                  <p className="mt-1 text-xs text-muted-foreground">Started {when(p.created_at)}{p.note ? ` · ${p.note}` : ""}</p>
                </div>
                <Open onClick={() => openPage("payout")}>Open Payout</Open>
              </Row>
            ))}
            {data.commission.rows.map((p) => (
              <Row key={p.id}>
                <div className="min-w-0 text-sm">
                  <Badge tone={PAYOUT_WORDS[p.status].tone}>{PAYOUT_WORDS[p.status].label}</Badge> <span className="ml-1">Commission to {devices.nameOf(p.device_id)}: {payLine(p, devices.nameOf)}</span>
                  <p className="mt-1 text-xs text-muted-foreground">Started {when(p.created_at)}{p.note ? ` · ${p.note}` : ""}</p>
                </div>
                <Open onClick={() => openPage("commission")}>Open Commission</Open>
              </Row>
            ))}
          </Section>

          {data.sends.rows.length || data.sends.error ? (
            <Section title="Money a phone was told to send" part={data.sends}>
              {data.sends.rows.map((c) => (
                <Row key={c.id}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      {c.provider ? <ProviderChip provider={c.provider} /> : null}
                      <span className="text-sm font-medium">{SEND_WORD[c.kind] ?? c.kind}</span>
                      <StatusBadge status={c.status} kind="other" />
                      {c.amount != null ? <span className="text-sm font-semibold tabular">{tk(c.amount)}</span> : null}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <DeviceChip id={c.device_id} name={devices.nameOf(c.device_id)} />
                      {c.to_number ? <span>to {c.to_number}</span> : null}
                      {c.trx_id ? <span className="font-mono">{c.trx_id}</span> : null}
                      <span>{when(c.created_at)}</span>
                    </div>
                  </div>
                  <Open onClick={() => { window.location.hash = phoneHash(c.device_id, "send"); }}>Open the phone</Open>
                </Row>
              ))}
            </Section>
          ) : null}
        </div>
      ) : null}

      {canAskWalletApp(q) ? (
        <div className="mt-6">
          <h3 className="mb-2 text-base font-semibold">Ask the wallet's own app</h3>
          <AppSearch key={q.text} initial={q.text} />
        </div>
      ) : null}
    </>
  );
}

function Section<T>({ title, part, empty, children }: { title: string; part: Part<T>; empty?: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-base font-semibold">{title}{part.rows.length ? ` (${part.rows.length})` : ""}</h3>
      {part.error ? <p className="mb-2 text-sm text-status-warn">Could not search this part: {part.error}</p> : null}
      {part.rows.length ? <Card className="divide-y divide-border overflow-hidden">{children}</Card> : !part.error && empty ? <p className="text-sm text-muted-foreground">{empty}</p> : null}
    </section>
  );
}

const Row = ({ children }: { children: ReactNode }) => <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">{children}</div>;
const Open = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => <Button size="sm" variant="outline" onClick={onClick}>{children}</Button>;

function PaymentRow({ p, phone, payout, nameOf, note }: { p: Payment; phone: string; payout: PayoutRow | undefined; nameOf: (id: string | null | undefined) => string; note: ReactNode }) {
  const [open, setOpen] = useState(false);
  const reason = p.status === "review" || p.status === "ignored" ? reviewReasonText(p.review_reason) : null;
  const page: TabId = p.status === "review" ? "review" : "payments";
  const at = p.occurred_at ?? p.received_at;
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {open ? <ChevronDown className="h-4 w-4 shrink-0" aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />}
            <ProviderChip provider={p.provider} />
            <span className="font-mono text-xs">{p.trx_id}</span>
            <span className="text-sm font-semibold tabular">{tk(p.amount)}</span>
            <span className="text-sm">{TYPE_LABEL[p.txn_type] ?? p.txn_type}</span>
            <StatusBadge status={p.status} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <DeviceChip id={p.device_id} name={phone} />
            <span>{when(at)}</span>
            {p.counterparty ? <span>{p.counterparty}</span> : null}
            {note}
            <span>Admin Hub sees: {hubView(p.status).label}</span>
          </div>
        </button>
        <Open onClick={() => (page === "review" ? openPage("review") : openPaymentsWith({ from: dayOf(at), to: dayOf(at), search: p.trx_id }))}>
          {page === "review" ? "Open Review" : "Open Transactions"}
        </Open>
      </div>
      {reason ? <p className="mt-2 text-sm text-status-warn">{reason}</p> : null}
      <p className="mt-2 text-sm">
        {payout ? <>Payout: <Badge tone={PAYOUT_WORDS[payout.status].tone}>{PAYOUT_WORDS[payout.status].label}</Badge> <span className="ml-1">{payoutLine(payout, nameOf)}</span></> : <span className="text-muted-foreground">Not in any payout.</span>}
      </p>
      {open ? <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">{p.raw_message}</pre> : null}
      <span className="sr-only">{PROVIDER_LABEL[p.provider] ?? p.provider}</span>
    </div>
  );
}
