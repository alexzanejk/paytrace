import { useState } from "react";
import { Download } from "lucide-react";
import { must, sb } from "@/lib/supabase";
import { tk, when } from "@/lib/format";
import { periodRange, rangeBounds, rangeLabel } from "@/lib/period";
import { useQuery } from "@/hooks/useQuery";
import { useDevices } from "@/hooks/useDevices";
import { leftoverText } from "@/lib/jobs";
import {
  CSV_HEADER, csvRows, fromCashin, fromOpenCrypto, fromTransfer, resultText, rowsFor, stageCounts, STAGE_HELP, STAGE_LABEL, STAGES, timeOf,
  totalsByPhone, type HistoryItem, type JobKindH, type Stage,
} from "@/lib/jobHistory";
import { downloadText, toCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";
import { CostLine } from "@/pages/CashInJobs";
import { Screen } from "@/components/Screen";
import { PageHeader } from "@/components/PageHeader";
import { PeriodPicker, type PeriodState } from "@/components/PeriodPicker";
import { FilterSelect, ALL } from "@/components/FilterSelect";
import { DeviceChip } from "@/components/DeviceChip";
import { ProviderChip } from "@/components/ProviderChip";
import { Confirm } from "@/components/Confirm";
import { EmptyRow } from "@/components/Empty";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dhakaDay } from "@/lib/period";

const TONE: Record<Stage, "warn" | "ok" | "bad" | "idle"> = { pending: "idle", waiting: "warn", done: "ok", closed: "bad" };
const OPEN = ["open", "checking", "mismatch", "review"];
const WAITING = ["checking", "mismatch", "review"];

/** Every job, both kinds, in four tabs (owner 2026-11-08: "where do we see completed and pending jobs ... build the job
 *  history with tabs"). Pending and Waiting show everything open however old; Done and Rejected / cancelled follow the dates. */
export function JobHistory() {
  const devices = useDevices();
  const [stage, setStage] = useState<Stage>("pending");
  const [period, setPeriod] = useState<PeriodState>({ id: "7d", custom: { from: dhakaDay(), to: dhakaDay() } });
  const [device, setDevice] = useState(ALL);
  const [kind, setKind] = useState(ALL);
  const range = periodRange(period.id, period.custom);
  const { startIso, endIso } = rangeBounds(range);

  const { data, error, loading, refresh } = useQuery(
    async () => {
      const takaOpen = must(await sb.from("cashin_jobs").select("*").in("status", OPEN)) as Record<string, unknown>[];
      const takaSettled = must(await sb.from("cashin_jobs").select("*").in("status", ["verified", "rejected", "cancelled"])
        .gte("checked_at", startIso).lt("checked_at", endIso).order("checked_at", { ascending: false }).limit(1000)) as Record<string, unknown>[];
      const sendsOpen = must(await sb.from("job_transfers").select("*").in("status", WAITING)) as Record<string, unknown>[];
      const sendsSettled = must(await sb.from("job_transfers").select("*").in("status", ["verified", "rejected"])
        .gte("checked_at", startIso).lt("checked_at", endIso).order("checked_at", { ascending: false }).limit(1000)) as Record<string, unknown>[];
      const cryptoOnPhone = must(await sb.rpc("admin_open_jobs")) as Record<string, unknown>[];
      const items: HistoryItem[] = [
        ...takaOpen.map(fromCashin), ...takaSettled.map(fromCashin),
        ...sendsOpen.map(fromTransfer), ...sendsSettled.map(fromTransfer),
        ...cryptoOnPhone.map(fromOpenCrypto),
      ];
      return { items, capped: takaSettled.length >= 1000 || sendsSettled.length >= 1000 };
    },
    [startIso, endIso],
    { refreshMs: 20000 },
  );

  const filter = { device: device === ALL ? null : device, kind: kind === ALL ? null : (kind as JobKindH), from: range.from, to: range.to };
  const items = data?.items ?? [];
  const counts = stageCounts(items, filter);
  const rows = rowsFor(items, stage, filter);
  const dated = stage === "done" || stage === "closed";
  const phoneOptions = devices.list.filter((d) => d.status === "approved").map((d) => ({ value: d.id, label: d.name || d.pair_code }));

  function downloadCsv() {
    downloadText(`jobs-${stage}-${range.from}-to-${range.to}.csv`, toCsv(CSV_HEADER, csvRows(rows, devices.nameOf)));
  }

  return (
    <Screen loading={loading || devices.loading} error={error ?? devices.error} hasData={!!data}>
      <PageHeader
        title="Job history"
        description="Every job on every phone, Taka and Crypto."
        help={<><p>Pending: on the phones now.</p><p>Waiting for OK: the partner says it is done; accept it once the money reached you.</p><p>Done: verified.</p><p>Rejected / cancelled: not accepted, or taken off the phone.</p></>}
        actions={<Button size="sm" variant="outline" onClick={downloadCsv} disabled={rows.length === 0}><Download aria-hidden /> CSV</Button>}
      />

      {/* Two by two on a phone, one row from a tablet up. */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap" role="tablist" aria-label="Job stage">
        {STAGES.map((st) => (
          <button
            key={st}
            type="button"
            role="tab"
            aria-selected={stage === st}
            onClick={() => setStage(st)}
            className={cn(
              "flex items-center justify-between gap-2 rounded-2xl border px-3 py-1.5 text-left text-sm leading-tight transition-colors sm:justify-start sm:rounded-full sm:py-1",
              stage === st ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            <span>{STAGE_LABEL[st]}</span>
            <span className={cn("tabular", stage === st ? "opacity-80" : "")}>{counts[st]}</span>
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {dated ? <PeriodPicker value={period} onChange={setPeriod} /> : null}
        <FilterSelect label="All phones" value={device} onChange={setDevice} options={phoneOptions} className="w-[calc(50%-0.25rem)] sm:w-48" />
        <FilterSelect label="Taka and Crypto" value={kind} onChange={setKind} options={[{ value: "taka", label: "Taka job" }, { value: "crypto", label: "Crypto job" }]} />
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        {STAGE_HELP[stage]} {dated ? `Showing ${rangeLabel(range)}, by when it was settled.` : "Shown however old."}
        {dated && data?.capped ? " Only the newest 1,000 are shown: pick fewer days to see the rest." : ""}
      </p>

      {stage === "done" && rows.length > 0 ? <DoneTotals rows={rows} nameOf={devices.nameOf} /> : null}

      {/* Phones and tablets: one card per job (two side by side on a tablet). */}
      <div className="grid gap-3 md:grid-cols-2 lg:hidden">
        {rows.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground md:col-span-2">Nothing here{dated ? " for these dates" : ""}.</Card>
        ) : (
          rows.map((i) => <JobRowCard key={i.id} item={i} name={devices.nameOf(i.device_id)} onDone={refresh} />)
        )}
      </div>

      {/* Computers: the table. */}
      <div className="hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When (BD)</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Job</TableHead>
              <TableHead className="text-right">Sent</TableHead>
              <TableHead>Other cost</TableHead>
              <TableHead>Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow cols={6} text={`Nothing here${dated ? " for these dates" : ""}.`} />
            ) : (
              rows.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="align-top">
                    {when(timeOf(i))}
                    {i.submitted_at && i.shown_at ? <span className="block text-xs text-muted-foreground">shown {when(i.shown_at)}</span> : null}
                  </TableCell>
                  <TableCell className="max-w-60 align-top">
                    <DeviceChip id={i.device_id} name={devices.nameOf(i.device_id)} />
                    <ProviderChip provider={i.provider} className="mt-0.5 flex text-xs" />
                  </TableCell>
                  <TableCell className="align-top text-sm">
                    {jobWord(i)}
                    {i.number ? <span className="block font-mono text-xs text-muted-foreground">to {i.number}</span> : null}
                    <span className="block text-xs text-muted-foreground tabular">balance {i.balance == null ? "–" : tk(i.balance)}</span>
                  </TableCell>
                  <TableCell className="text-right align-top tabular">
                    {i.amount == null ? "–" : tk(i.amount)}
                    {i.amount != null ? <span className="block text-xs text-muted-foreground">{i.kind === "taka" ? "comm." : "charge"} {tk(i.charge ?? 0)}</span> : null}
                  </TableCell>
                  <TableCell className="whitespace-normal align-top"><CostLine cost={i.cost} note={i.cost_note} /></TableCell>
                  <TableCell className="whitespace-normal align-top">
                    <Badge tone={TONE[i.stage]} className="whitespace-nowrap">{resultText(i)}</Badge>
                    {i.stage === "waiting" && i.diff != null ? <span className="mt-0.5 block text-xs text-muted-foreground">Off by {leftoverText(i.diff)}</span> : null}
                    {i.note ? <span className="mt-0.5 block max-w-56 text-xs text-muted-foreground">Your note: {i.note}</span> : null}
                    <div className="mt-1.5"><Actions item={i} onDone={refresh} /></div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </Screen>
  );
}

const jobWord = (i: HistoryItem) => (i.kind === "taka" ? "Taka job" : "Crypto job");

/** One job as a card, for phones and tablets: who, what happened, the money, the partner's cost note, and the buttons. */
function JobRowCard({ item: i, name, onDone }: { item: HistoryItem; name: string; onDone: () => void }) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <DeviceChip id={i.device_id} name={name} />
          <ProviderChip provider={i.provider} className="mt-0.5 flex text-xs" />
        </div>
        <Badge tone={TONE[i.stage]} className="max-w-full">{resultText(i)}</Badge>
      </div>
      <div className="text-sm">
        <span className="font-medium">{jobWord(i)}</span>
        {i.number ? <span className="text-muted-foreground"> · to <span className="font-mono">{i.number}</span></span> : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Sent</dt>
          <dd className="font-semibold tabular">{i.amount == null ? "–" : tk(i.amount)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{i.kind === "taka" ? "Commission" : "Charge"}</dt>
          <dd className="tabular">{i.charge == null ? "–" : tk(i.charge)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Balance when shown</dt>
          <dd className="tabular">{i.balance == null ? "–" : tk(i.balance)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{i.settled_at ? "Settled" : i.submitted_at ? "Submitted" : "Shown"} (BD)</dt>
          <dd>{when(timeOf(i))}</dd>
        </div>
      </dl>
      {i.cost > 0 || i.cost_note ? (
        <div className="rounded-lg bg-muted/60 px-3 py-2"><CostLine cost={i.cost} note={i.cost_note} labelled /></div>
      ) : null}
      {i.stage === "waiting" && i.diff != null ? <p className="text-xs text-muted-foreground">Off by {leftoverText(i.diff)}</p> : null}
      {i.note ? <p className="text-xs text-muted-foreground">Your note: {i.note}</p> : null}
      <Actions item={i} onDone={onDone} wide />
    </Card>
  );
}

/** What each partner sent in the Done rows of the chosen dates. */
function DoneTotals({ rows, nameOf }: { rows: HistoryItem[]; nameOf: (id: string) => string }) {
  const totals = totalsByPhone(rows);
  const all = totals.reduce((a, t) => ({ jobs: a.jobs + t.jobs, sent: a.sent + t.sent, charge: a.charge + t.charge, cost: a.cost + t.cost }), { jobs: 0, sent: 0, charge: 0, cost: 0 });
  return (
    <Card className="mb-4 p-4">
      <h3 className="mb-2 text-sm font-semibold">Done in these dates, by phone</h3>
      {/* Phones: one line per phone with every figure; computers: the table. */}
      <ul className="divide-y divide-border sm:hidden">
        {[...totals, ...(totals.length > 1 ? [{ device_id: "", ...all }] : [])].map((t) => (
          <li key={t.device_id || "all"} className="py-2.5 first:pt-0 last:pb-0">
            <div className="flex items-center justify-between gap-2">
              {t.device_id ? <DeviceChip id={t.device_id} name={nameOf(t.device_id)} /> : <span className="font-semibold">All phones</span>}
              <span className="font-semibold tabular">{tk(t.sent)}</span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground tabular">
              {t.jobs} job{t.jobs === 1 ? "" : "s"} · comm. / charge {tk(t.charge)} · other cost {tk(t.cost)}
            </p>
          </li>
        ))}
      </ul>
      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Phone</TableHead>
              <TableHead className="text-right">Jobs</TableHead>
              <TableHead className="text-right">Sent</TableHead>
              <TableHead className="text-right">Comm. / charge</TableHead>
              <TableHead className="text-right">Other cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {totals.map((t) => (
              <TableRow key={t.device_id}>
                <TableCell><DeviceChip id={t.device_id} name={nameOf(t.device_id)} /></TableCell>
                <TableCell className="text-right tabular">{t.jobs}</TableCell>
                <TableCell className="text-right tabular">{tk(t.sent)}</TableCell>
                <TableCell className="text-right tabular">{tk(t.charge)}</TableCell>
                <TableCell className="text-right tabular">{tk(t.cost)}</TableCell>
              </TableRow>
            ))}
            {totals.length > 1 ? (
              <TableRow>
                <TableCell className="font-semibold">All phones</TableCell>
                <TableCell className="text-right font-semibold tabular">{all.jobs}</TableCell>
                <TableCell className="text-right font-semibold tabular">{tk(all.sent)}</TableCell>
                <TableCell className="text-right font-semibold tabular">{tk(all.charge)}</TableCell>
                <TableCell className="text-right font-semibold tabular">{tk(all.cost)}</TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

/** Accept / Reject a waiting job; cancel a Taka job that is still on the phone. A crypto job on the phone ends when the wallet's
 *  job is switched (Jobs page). */
function Actions({ item, onDone, wide = false }: { item: HistoryItem; onDone: () => void; wide?: boolean }) {
  const [problem, setProblem] = useState("");
  async function act(decision: "verified" | "rejected" | "cancelled") {
    setProblem("");
    const { error } = item.kind === "taka"
      ? await sb.rpc("resolve_cashin_job", { p_id: item.id, p_decision: decision })
      : await sb.rpc("resolve_job_transfer", { p_id: item.id, p_decision: decision });
    if (error) setProblem(error.message);
    else onDone();
  }
  let buttons = null;
  if (item.stage === "waiting") {
    buttons = (
      <div className={cn("flex gap-1", wide && "grid grid-cols-2 gap-2")}>
        <Confirm title="Accept this job?" description="Only do this after you have checked the money reached us. The job counts as done; PayTrace stops waiting for the wallet's message." confirmLabel="Accept" onConfirm={() => act("verified")}>
          <Button size="sm" variant={wide ? "default" : "outline"} className={cn(wide && "w-full")}>Accept</Button>
        </Confirm>
        <Confirm title="Reject this job?" description="The partner will see that it was not accepted." confirmLabel="Reject" onConfirm={() => act("rejected")}>
          <Button size="sm" variant={wide ? "outline" : "ghost"} className={cn(wide && "w-full")}>Reject</Button>
        </Confirm>
      </div>
    );
  } else if (item.stage === "pending" && item.kind === "taka") {
    buttons = (
      <Confirm title="Take this job off the phone?" description="The partner will no longer see it. A new one starts with the next balance message that reaches the amount." confirmLabel="Cancel job" onConfirm={() => act("cancelled")}>
        <Button size="sm" variant={wide ? "outline" : "ghost"} className={cn(wide && "w-full")}>Cancel job</Button>
      </Confirm>
    );
  }
  if (!buttons) return null;
  return (
    <div className={cn("flex flex-col items-start gap-1", wide && "items-stretch")}>
      {buttons}
      {problem ? <p role="alert" className="text-xs text-destructive">{problem}</p> : null}
    </div>
  );
}
