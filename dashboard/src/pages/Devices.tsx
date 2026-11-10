import { useState } from "react";
import { BatteryMedium, BellRing, ChevronLeft, ChevronRight, Check, HeartPulse, ListOrdered, Pencil, Smartphone, X } from "lucide-react";
import { must, sb } from "@/lib/supabase";
import { tk, when } from "@/lib/format";
import { PROVIDER_LABEL, type Device, type DeviceBalance, type DeviceWallet } from "@/lib/types";
import { addDays, dayLabel, dhakaDay, groupSummary, summarize, type DayTotal } from "@/lib/period";
import { openPaymentsWith } from "@/lib/filters";
import { infoProblems } from "@/lib/deviceHealth";
import { useQuery } from "@/hooks/useQuery";
import { wakePhone, WAKE_TEXT } from "@/lib/wake";
import { Screen } from "@/components/Screen";
import { PageHeader } from "@/components/PageHeader";
import { StatCard, STAT_GRID } from "@/components/StatCard";
import { Confirm } from "@/components/Confirm";
import { DeviceChip } from "@/components/DeviceChip";
import { DeviceHealthBadge } from "@/components/DeviceHealthBadge";
import { DeviceDetails } from "@/components/DeviceDetails";
import { WalletsCard } from "@/components/WalletsCard";
import { BalanceCheck } from "@/components/BalanceCheck";
import { WALLETS } from "@/lib/phoneCommands";
import { StatementSection } from "@/components/StatementSection";
import { PhoneActions } from "@/components/PhoneActions";
import { CashInSection } from "@/components/CashInSection";
import { B2bCommand } from "@/components/B2bCommand";
import { PhonePermissions } from "@/components/PhonePermissions";
import { AppVersionCard, OutdatedCard, VersionChip } from "@/components/AppVersionCard";
import { latestReleaseBuild } from "@/lib/latestRelease";
import { newestOf } from "@/lib/appVersion";
import { GROUP_CODE, GroupChoice } from "@/components/GroupChoice";
import { CommissionCard } from "@/components/CommissionCard";
import { B2BFloat } from "@/components/B2BFloat";
import { DayMoney } from "@/components/DayMoney";
import { dayTotals, rowsOf, type DayCheckRow, type DayMoneyRow } from "@/lib/dayMoney";
import type { B2BFloatRow } from "@/lib/ledger";
import type { GapRow } from "@/lib/gaps";
import { NOT_OURS_RULE, notOursLines, type NotOursRow } from "@/lib/notOurs";
import type { CommissionBalance, RateRow } from "@/lib/commission";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useNow } from "@/hooks/useNow";
import { deviceHealth } from "@/lib/deviceHealth";
import { depositCoverage, type WalletOrderStat } from "@/lib/walletNumbers";

export function Devices() {
  const [failed, setFailed] = useState<Record<string, string>>({});
  // The group chosen for each waiting phone before it is approved ("main" unless the owner picks a partner code).
  const [wakingAll, setWakingAll] = useState(false);
  const [wakeAllNote, setWakeAllNote] = useState("");
  const [pickGroup, setPickGroup] = useState<Record<string, string>>({});
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
      // The B2B float, through an admin-only function (migration 060: the view itself is refused for the signed-in admin).
      // A failure never stops the page, but it is SHOWN on the B2B card, never turned into zeros without a word.
      const floatRes = await sb.rpc("wallet_b2b_floats");
      const floats = (floatRes.data ?? []) as B2BFloatRow[];
      const floatsError = floatRes.error ? floatRes.error.message : "";
      // Each account's day, every movement counted once (migration 065). A failure is shown on the card, never as zeros.
      const moneyRes = await sb.rpc("device_day_money", { p_day: day });
      const dayMoney = (moneyRes.data ?? []) as DayMoneyRow[];
      const dayMoneyError = moneyRes.error ? moneyRes.error.message : "";
      // Whether every balance change of the day is accounted for (migration 069). Shown on the card, never hidden.
      const checkRes = await sb.rpc("device_day_check", { p_day: day });
      const dayChecks = (checkRes.data ?? []) as DayCheckRow[];
      const dayCheckError = checkRes.error ? checkRes.error.message : "";
      // Balance moves no SMS explains (migration 063), still open; a missing table never stops the page.
      const gapRes = await sb.from("balance_gaps").select("*").is("explained_by", null).order("at", { ascending: false }).limit(200);
      const gaps = (gapRes.data ?? []) as GapRow[];
      // Messages ignored as "not ours" in the last 7 days (migration 064); a missing view never stops the page.
      const notOursRes = await sb.from("device_not_ours").select("*");
      const notOurs = (notOursRes.data ?? []) as NotOursRow[];
      const wallets = must(await sb.from("device_wallets").select("*").order("created_at", { ascending: true })) as DeviceWallet[];
      // Deposit orders per wallet in the last 24 h (view wallet_order_stats, migration 052). A missing view never stops the page.
      const statRes = await sb.from("wallet_order_stats").select("*");
      const walletStats = (statRes.data ?? []) as WalletOrderStat[];
      // Partner commission (added later; reading these never changes anything above).
      const rates = must(await sb.from("commission_rates").select("device_id,provider,kind,rate_pct,effective_from")) as RateRow[];
      const commission = must(await sb.from("device_commission_balance").select("*")) as CommissionBalance[];
      const groups = (must(await sb.from("wallet_groups").select("name").order("name")) as { name: string }[]).map((g) => g.name);
      // The newest app version (update system). A missing table never stops the page.
      const rel = await sb.from("app_release").select("version_code,notes").limit(1);
      const release = (rel.data?.[0] ?? null) as { version_code: number; notes: string | null } | null;
      // The newest build on the download link (GitHub release), so an outdated phone is seen without anyone typing the
      // number (owner 2026-11-08). The typed number stays as the fallback; the higher of the two wins.
      const fromLink = await latestReleaseBuild();
      const newestBuild = newestOf(release?.version_code, fromLink);
      if (fromLink && (!release || fromLink > release.version_code)) {
        // Keep the database in step, quietly: the phone's own update check does not read it, but other pages may.
        await sb.rpc("set_app_release", { p_version_code: fromLink, p_notes: release?.notes ?? null }).then(() => undefined, () => undefined);
      }
      return { devices, totals, balances, floats, floatsError, dayMoney, dayMoneyError, dayChecks, dayCheckError, gaps, notOurs, wallets, walletStats, rates, commission, groups, release, newestBuild, fromLink };
    },
    [day],
    { refreshMs: 10000 },
  );

  async function setStatus(device: Device, status: "approved" | "revoked") {
    const { error } = await sb.rpc("set_device_status", { p_device_id: device.id, p_status: status });
    if (error) return setFailed((f) => ({ ...f, [device.id]: error.message }));
    const group = pickGroup[device.id] ?? "main";
    if (status === "approved" && group !== "main" && GROUP_CODE.test(group)) {
      // The phone is approved already; if the group step fails the owner can still set it on the phone's card.
      const { error: groupError } = await sb.rpc("set_device_group", { p_device_id: device.id, p_group: group, p_move_numbers: true });
      if (groupError) return setFailed((f) => ({ ...f, [device.id]: `Approved, but the group was not set: ${groupError.message}` }));
    }
    setFailed((f) => ({ ...f, [device.id]: "" }));
    refresh();
  }

  const devices = data?.devices ?? [];
  const pending = devices.filter((d) => d.status === "pending");
  const approved = devices.filter((d) => d.status === "approved");
  // What the pay page can hand out right now: a wallet with no live valid number, or a live number that is not a real number.
  const coverage = depositCoverage(data?.wallets ?? [], devices);
  const totals = data?.totals ?? [];
  const perDevice = groupSummary(totals, (r) => r.device_id ?? "none");
  const fleet = summarize(totals);
  const online = approved.filter((d) => deviceHealth(d, now).level === "online").length;
  // Two phones showing the same code would make "approve the right one" impossible.
  const sharedCode = (code: string) => pending.filter((d) => d.pair_code === code).length > 1;
  const offline = approved.filter((d) => deviceHealth(d, now).level !== "online");

  /** One tap: a wake-up push to every phone that is not online right now. */
  async function wakeAll() {
    setWakingAll(true);
    setWakeAllNote("");
    const results = await Promise.all(offline.map((d) => wakePhone(d.id)));
    const sent = results.filter((r) => r === "sent").length;
    const first = results.find((r) => r !== "sent");
    setWakeAllNote(
      offline.length === 0
        ? "Every phone is online."
        : sent === offline.length
          ? `Wake-up sent to ${sent} phone${sent === 1 ? "" : "s"}. They should be back within a minute or two.`
          : `Sent to ${sent} of ${offline.length}. ${first ? WAKE_TEXT[first] : ""}`,
    );
    setWakingAll(false);
  }

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
            <Button size="sm" className="ml-2" onClick={() => void wakeAll()} disabled={wakingAll || offline.length === 0}>
              <BellRing aria-hidden /> {wakingAll ? "Sending…" : offline.length ? `Wake ${offline.length} offline` : "All online"}
            </Button>
          </div>
        }
      />

      {wakeAllNote ? <p role="status" className="mb-4 text-sm text-muted-foreground">{wakeAllNote}</p> : null}

      <OutdatedCard phones={approved.map((d) => ({ name: d.name, version: d.info?.app_version }))} newest={data?.newestBuild ?? null} />

      <AppVersionCard
        newest={data?.newestBuild ?? null}
        fromLink={data?.fromLink ?? null}
        notes={data?.release?.notes ?? null}
        versions={approved.map((d) => d.info?.app_version)}
        onChanged={refresh}
      />

      <div className={`mb-6 ${STAT_GRID}`}>
        <StatCard tone="blue" label="Phones online" value={`${online} of ${approved.length}`} sub={dayLabel(day)} icon={Smartphone} />
        <StatCard tone="green" label="Received" value={tk(fleet.received.amount)} sub={`${fleet.received.n} payments, all phones`} />
        <StatCard tone="purple" label="Agent Cash Out" value={tk(fleet.cashOut.amount)} sub={`${fleet.cashOut.n} receipts, all phones`} />
        <StatCard tone="amber" label="Commission" value={tk(fleet.commission)} sub="all phones" />
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
                <TableHead>Group</TableHead>
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
                    <GroupChoice
                      groups={data?.groups ?? []}
                      value={pickGroup[d.id] ?? "main"}
                      onChange={(g) => setPickGroup((m) => ({ ...m, [d.id]: g }))}
                      label={`Group for the phone showing ${d.pair_code}`}
                    />
                  </TableCell>
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

      {coverage.missing.length > 0 || coverage.invalid.length > 0 ? (
        <Card className="border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100" role="status">
          <p className="font-medium">Deposit numbers need attention</p>
          <ul className="mt-1 list-disc pl-5">
            {coverage.invalid.map((x) => (
              <li key={x.phone + x.provider}>
                {x.phone}: the {PROVIDER_LABEL[x.provider] ?? x.provider} number {x.number} is not a valid 11-digit number. Customers are being shown it and cannot pay. Add the right number on that phone's card (it replaces this one).
              </li>
            ))}
            {coverage.missing.map((p) => (
              <li key={p}>No live {PROVIDER_LABEL[p] ?? p} number on any connected phone: a website asking for {PROVIDER_LABEL[p] ?? p} gets no number. Add one under a phone's Deposit numbers.</li>
            ))}
          </ul>
        </Card>
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
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 2xl:grid-cols-2">
          {approved.map((d) => (
            <DeviceCard
              key={d.id}
              device={d}
              day={day}
              sum={perDevice.get(d.id)}
              balances={(data?.balances ?? []).filter((b) => b.device_id === d.id)}
              floats={(data?.floats ?? []).filter((f) => f.device_id === d.id)}
              floatsError={data?.floatsError ?? ""}
              gaps={(data?.gaps ?? []).filter((g) => g.device_id === d.id)}
              notOurs={data?.notOurs ?? []}
              wallets={(data?.wallets ?? []).filter((w) => w.device_id === d.id)}
              walletStats={(data?.walletStats ?? []).filter((x) => x.device_id === d.id)}
              dayMoney={rowsOf(data?.dayMoney ?? [], d.id)}
              dayMoneyError={data?.dayMoneyError ?? ""}
              dayChecks={(data?.dayChecks ?? []).filter((c) => c.device_id === d.id)}
              dayCheckError={data?.dayCheckError ?? ""}
              rates={(data?.rates ?? []).filter((r) => r.device_id === d.id)}
              commission={(data?.commission ?? []).find((c) => c.device_id === d.id)}
              newest={data?.newestBuild ?? null}
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
  balances,
  floats,
  floatsError,
  gaps,
  notOurs,
  wallets,
  walletStats,
  dayMoney,
  dayMoneyError,
  dayChecks,
  dayCheckError,
  rates,
  commission,
  newest,
  error,
  onChanged,
  onRemove,
  onError,
}: {
  device: Device;
  day: string;
  sum: ReturnType<typeof summarize> | undefined;
  balances: DeviceBalance[];
  floats: B2BFloatRow[];
  floatsError: string;
  gaps: GapRow[];
  notOurs: NotOursRow[];
  wallets: DeviceWallet[];
  walletStats: WalletOrderStat[];
  dayMoney: DayMoneyRow[];
  dayMoneyError: string;
  dayChecks: DayCheckRow[];
  dayCheckError: string;
  rates: RateRow[];
  commission: CommissionBalance | undefined;
  newest: number | null;
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
  // The headline counts every movement once, SMS or statement (the same figures as the blocks below); the SMS-only
  // totals are the fallback if the day's figures could not be loaded.
  const merged = dayMoneyError ? null : dayTotals(dayMoney);
  const received = merged ? merged.received : s.received;
  const cashOut = merged ? merged.cashOut : s.cashOut;
  const problems = infoProblems(d.info).length;

  /** Sends one wake-up push to this phone right now. If it arrives, the phone is back within a minute or two. */
  async function testWake() {
    setWaking(true);
    setWakeNote("");
    setWakeNote(WAKE_TEXT[await wakePhone(d.id)]);
    setWaking(false);
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
            <VersionChip version={d.info?.app_version} newest={newest} />
          </p>
        </div>
        <DeviceHealthBadge device={d} />
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Received</p>
          <p className="whitespace-nowrap text-base font-semibold tabular sm:text-lg">{tk(received.amount)}</p>
          <p className="text-xs text-muted-foreground">{received.n} payments</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Cash Out</p>
          <p className="whitespace-nowrap text-base font-semibold tabular sm:text-lg">{tk(cashOut.amount)}</p>
          <p className="text-xs text-muted-foreground">{cashOut.n} receipts</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Commission</p>
          <p className="whitespace-nowrap text-base font-semibold tabular sm:text-lg">{tk(s.commission)}</p>
        </div>
      </div>

      <DayMoney deviceId={d.id} rows={dayMoney} checks={dayChecks} error={dayMoneyError} checkError={dayCheckError} dayLabel={dayLabel(day)} today={day === dhakaDay()} />

      <WalletsCard deviceId={d.id} wallets={wallets} reported={d.info?.wallets} stats={walletStats} defaultGroup={d.default_group ?? "main"} onChanged={onChanged} />

      <B2BFloat deviceId={d.id} floats={floats} loadError={floatsError} balances={balances} gaps={gaps} onChanged={onChanged} />

      <CommissionCard device={d} rates={rates} balance={commission} onChanged={onChanged} />

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => openPaymentsWith({ device: d.id, from: day, to: day })}>
          <ListOrdered aria-hidden /> View transactions
        </Button>
        <Button size="sm" variant="outline" onClick={() => setShowHealth((v) => !v)} aria-expanded={showHealth}>
          <HeartPulse aria-hidden /> Phone health{problems ? ` (${problems})` : ""}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void testWake()} disabled={waking}>
          <BellRing aria-hidden /> {waking ? "Sending…" : "Wake up now"}
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
      {d.status === "approved" ? (
        <div className="flex flex-col gap-2">
          <PhoneActions deviceId={d.id} />
          <PhonePermissions device={d} onChanged={onChanged} />
          {d.allow_balance !== false ? WALLETS.map((w) => <BalanceCheck key={w} deviceId={d.id} provider={w} />) : null}
          {d.allow_cashin === true ? <CashInSection deviceId={d.id} /> : null}
          {d.allow_cashin === true ? <B2bCommand deviceId={d.id} /> : null}
          {d.allow_balance !== false ? <StatementSection deviceId={d.id} wallets={d.info?.wallets} /> : null}
        </div>
      ) : null}
      {(() => {
        const ignored = notOursLines(notOurs, d.id, d.info?.wallets);
        return ignored.length ? (
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm" role="note">
            {ignored.map((line) => <p key={line}>{line}</p>)}
            <p className="mt-1 text-xs text-muted-foreground">{NOT_OURS_RULE}</p>
          </div>
        ) : null;
      })()}
      {showHealth ? <DeviceDetails info={d.info} /> : null}
    </Card>
  );
}
