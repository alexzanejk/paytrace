import { useState } from "react";
import { BatteryMedium, BellRing, ChevronLeft, ChevronRight, Check, HeartPulse, ListOrdered, Pencil, Smartphone, X } from "lucide-react";
import { INGEST_URL, must, sb } from "@/lib/supabase";
import { tk, when } from "@/lib/format";
import { PROVIDERS, type Device, type DeviceBalance } from "@/lib/types";
import { addDays, dayLabel, dhakaDay, groupSummary, summarize, type DayTotal } from "@/lib/period";
import { openPaymentsWith } from "@/lib/filters";
import { infoProblems } from "@/lib/deviceHealth";
import { useQuery } from "@/hooks/useQuery";
import { Screen } from "@/components/Screen";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { Confirm } from "@/components/Confirm";
import { DeviceChip } from "@/components/DeviceChip";
import { ProviderChip } from "@/components/ProviderChip";
import { DeviceHealthBadge } from "@/components/DeviceHealthBadge";
import { DeviceDetails } from "@/components/DeviceDetails";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyRow } from "@/components/Empty";
import { useNow } from "@/hooks/useNow";
import { deviceHealth } from "@/lib/deviceHealth";

export function Devices() {
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [day, setDay] = useState(dhakaDay());
  const today = dhakaDay();
  const now = useNow(5000);

  const { data, error, loading, refresh } = useQuery(
    async () => {
      const devices = must(
        await sb.from("devices").select("*").neq("status", "revoked").order("created_at", { ascending: true }).limit(200),
      ) as Device[];
      const totals = must(await sb.from("device_day_totals").select("*").eq("day", day)) as DayTotal[];
      const balances = must(await sb.from("device_balances").select("*")) as DeviceBalance[];
      return { devices, totals, balances };
    },
    [day],
    { refreshMs: 10000 },
  );

  async function setStatus(device: Device, status: "approved" | "revoked") {
    const { error } = await sb.rpc("set_device_status", { p_device_id: device.id, p_status: status });
    if (error) setFailed((f) => ({ ...f, [device.id]: error.message }));
    else {
      setFailed((f) => ({ ...f, [device.id]: "" }));
      refresh();
    }
  }

  const devices = data?.devices ?? [];
  const pending = devices.filter((d) => d.status === "pending");
  const approved = devices.filter((d) => d.status === "approved");
  const totals = data?.totals ?? [];
  const perDevice = groupSummary(totals, (r) => r.device_id ?? "none");
  const fleet = summarize(totals);
  const online = approved.filter((d) => deviceHealth(d, now).level === "online").length;
  // Two phones showing the same code would make "approve the right one" impossible.
  const sharedCode = (code: string) => pending.filter((d) => d.pair_code === code).length > 1;

  return (
    <Screen loading={loading} error={error} hasData={!!data}>
      <PageHeader
        title="Phones"
        description="Each phone that forwards payment messages. Totals run from 12:00 AM to 11:59 PM Bangladesh time."
        actions={
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => setDay(addDays(day, -1))}>
              <ChevronLeft />
            </Button>
            <Input
              type="date"
              className="w-40"
              aria-label="Day"
              max={today}
              value={day}
              onChange={(e) => e.target.value && setDay(e.target.value)}
            />
            <Button variant="outline" size="icon" aria-label="Next day" disabled={day >= today} onClick={() => setDay(addDays(day, 1))}>
              <ChevronRight />
            </Button>
            {day !== today ? (
              <Button variant="ghost" size="sm" onClick={() => setDay(today)}>
                Today
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Phones online" value={`${online} of ${approved.length}`} sub={dayLabel(day)} icon={Smartphone} />
        <StatCard label="Received" value={tk(fleet.received.amount)} sub={`${fleet.received.n} payments, all phones`} />
        <StatCard label="Agent Cash Out" value={tk(fleet.cashOut.amount)} sub={`${fleet.cashOut.n} receipts, all phones`} />
        <StatCard label="Commission" value={tk(fleet.commission)} sub="all phones" />
      </div>

      {pending.length > 0 ? (
        <section className="mb-6">
          <h3 className="mb-2 text-base font-semibold">Waiting for approval</h3>
          <p className="mb-3 max-w-3xl text-sm text-muted-foreground">
            A new phone shows a code on its screen. Approve it here only if the same code is on your own phone right now.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Asked (BD)</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono text-base font-semibold">{d.pair_code}</TableCell>
                  <TableCell>{d.name || "–"}</TableCell>
                  <TableCell>{when(d.created_at)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      {sharedCode(d.pair_code) ? (
                        <span className="text-sm text-destructive">Two requests share this code. Reject both and ask again on the phone.</span>
                      ) : (
                        <Confirm
                          title={`Approve the phone showing ${d.pair_code}?`}
                          description="Only do this if the same code is on your own phone right now. An approved phone can send payment messages to your server."
                          confirmLabel="Approve"
                          onConfirm={() => setStatus(d, "approved")}
                        >
                          <Button size="sm">Approve</Button>
                        </Confirm>
                      )}
                      <Confirm
                        title="Reject this request?"
                        description="The phone will not be able to send anything. It can ask again later."
                        confirmLabel="Reject"
                        onConfirm={() => setStatus(d, "revoked")}
                      >
                        <Button size="sm" variant="outline">Reject</Button>
                      </Confirm>
                      {failed[d.id] ? <span className="text-xs text-destructive">{failed[d.id]}</span> : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ) : null}

      {approved.length === 0 ? (
        <Card className="p-8 text-center">
          <Smartphone className="mx-auto mb-2 h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="font-medium">No phone is connected yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Install the app on a phone and open it. The phone shows a code; approve that code here. Nothing needs to be typed on the phone.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
          {approved.map((d) => (
            <DeviceCard
              key={d.id}
              device={d}
              day={day}
              sum={perDevice.get(d.id)}
              totals={totals.filter((t) => t.device_id === d.id)}
              balances={(data?.balances ?? []).filter((b) => b.device_id === d.id)}
              error={failed[d.id]}
              onChanged={refresh}
              onRemove={() => setStatus(d, "revoked")}
              onError={(m) => setFailed((f) => ({ ...f, [d.id]: m }))}
            />
          ))}
        </div>
      )}
    </Screen>
  );
}

function DeviceCard({
  device: d,
  day,
  sum,
  totals,
  balances,
  error,
  onChanged,
  onRemove,
  onError,
}: {
  device: Device;
  day: string;
  sum: ReturnType<typeof summarize> | undefined;
  totals: DayTotal[];
  balances: DeviceBalance[];
  error: string | undefined;
  onChanged: () => void;
  onRemove: () => void;
  onError: (m: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(d.name);
  const [showHealth, setShowHealth] = useState(false);
  const [waking, setWaking] = useState(false);
  const [wakeNote, setWakeNote] = useState("");
  const s = sum ?? summarize([]);
  const byProvider = groupSummary(totals, (r) => r.provider);
  const problems = infoProblems(d.info).length;

  /** Sends one wake-up push to this phone. If it arrives, the phone's health shows "N received" within a minute. */
  async function testWake() {
    setWaking(true);
    setWakeNote("");
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return setWakeNote("You are signed out. Sign in again and retry.");
      const res = await fetch(INGEST_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "test_wake", device_id: d.id }),
      });
      const b = (await res.json().catch(() => ({}))) as { configured?: boolean; registered?: boolean; result?: string; message?: string };
      if (!res.ok) setWakeNote(`Could not send: ${b.message ?? res.status}.`);
      else if (!b.configured) setWakeNote("Firebase is not set up on the server yet (the FIREBASE_SERVICE_ACCOUNT secret).");
      else if (!b.registered) setWakeNote("This phone has not registered for wake-ups. Install the newest app and open it once.");
      else if (b.result === "sent") setWakeNote("Sent to Google. Open Phone health in a minute: if it arrived, it says \"1 received\" or more.");
      else setWakeNote("Google did not accept the message. Try again in a minute.");
    } catch {
      setWakeNote("Could not reach the server. Check your internet and try again.");
    } finally {
      setWaking(false);
    }
  }

  async function save() {
    const { error } = await sb.rpc("rename_device", { p_device_id: d.id, p_name: name });
    if (error) return onError(error.message);
    onError("");
    setEditing(false);
    onChanged();
  }

  return (
    <Card className="flex min-w-0 flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <Input autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} aria-label="Phone name" className="h-9" />
              <Button type="submit" size="icon" variant="ghost" aria-label="Save name"><Check /></Button>
              <Button type="button" size="icon" variant="ghost" aria-label="Cancel" onClick={() => { setName(d.name); setEditing(false); }}><X /></Button>
            </form>
          ) : (
            <div className="flex items-center gap-1">
              <h3 className="min-w-0 text-lg font-semibold"><DeviceChip id={d.id} name={d.name || "Unnamed phone"} className="text-lg" /></h3>
              <Button size="icon" variant="ghost" aria-label="Rename this phone" onClick={() => setEditing(true)}><Pencil /></Button>
            </div>
          )}
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
            <span className="font-mono">{d.pair_code}</span>
            {d.info?.battery !== undefined ? (
              <span className="inline-flex items-center gap-1"><BatteryMedium className="h-3.5 w-3.5" aria-hidden />{d.info.battery}%</span>
            ) : null}
            {d.info?.app_version ? <span>v{d.info.app_version}</span> : null}
          </p>
        </div>
        <DeviceHealthBadge device={d} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Received</p>
          <p className="text-lg font-semibold tabular">{tk(s.received.amount)}</p>
          <p className="text-xs text-muted-foreground">{s.received.n} payments</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Cash Out</p>
          <p className="text-lg font-semibold tabular">{tk(s.cashOut.amount)}</p>
          <p className="text-xs text-muted-foreground">{s.cashOut.n} receipts</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Commission</p>
          <p className="text-lg font-semibold tabular">{tk(s.commission)}</p>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Provider</TableHead>
            <TableHead className="text-right">Received</TableHead>
            <TableHead className="text-right">Cash Out</TableHead>
            <TableHead className="text-right">Last balance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {PROVIDERS.filter((p) => byProvider.has(p) || balances.some((b) => b.provider === p)).length === 0 ? (
            <EmptyRow cols={4} text={`No transactions yet for ${dayLabel(day)}.`} />
          ) : (
            PROVIDERS.filter((p) => byProvider.has(p) || balances.some((b) => b.provider === p)).map((p) => {
              const ps = byProvider.get(p);
              const bal = balances.find((b) => b.provider === p);
              return (
                <TableRow key={p}>
                  <TableCell><ProviderChip provider={p} /></TableCell>
                  <TableCell className="text-right tabular">{ps && ps.received.n ? tk(ps.received.amount) : "–"}</TableCell>
                  <TableCell className="text-right tabular">{ps && ps.cashOut.n ? tk(ps.cashOut.amount) : "–"}</TableCell>
                  <TableCell className="text-right">
                    <span className="tabular">{bal ? tk(bal.balance) : "–"}</span>
                    {bal ? <span className="block text-xs text-muted-foreground">as of {when(bal.at)}</span> : null}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => openPaymentsWith({ device: d.id, from: day, to: day })}>
          <ListOrdered aria-hidden /> View transactions
        </Button>
        <Button size="sm" variant="outline" onClick={() => setShowHealth((v) => !v)} aria-expanded={showHealth}>
          <HeartPulse aria-hidden /> Phone health{problems ? ` (${problems})` : ""}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void testWake()} disabled={waking}>
          <BellRing aria-hidden /> {waking ? "Sending…" : "Test wake-up"}
        </Button>
        <Confirm
          title={`Remove ${d.name || d.pair_code}?`}
          description="It stops sending payments immediately. Its old transactions stay. To use it again you would approve a new code on that phone."
          confirmLabel="Remove"
          onConfirm={onRemove}
        >
          <Button size="sm" variant="ghost">Remove</Button>
        </Confirm>
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </div>
      {wakeNote ? <p role="status" className="text-sm text-muted-foreground">{wakeNote}</p> : null}
      {showHealth ? <DeviceDetails info={d.info} /> : null}
    </Card>
  );
}
