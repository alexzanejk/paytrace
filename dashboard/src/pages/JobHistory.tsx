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
        description="Every job on every phone, Taka and Crypto: what is on the phones now, what the partners say they did, what was verified, and what was rejected or cancelled."
        actions={<Button size="sm" variant="outline" onClick={downloadCsv} disabled={rows.length === 0}><Download aria-hidden /> CSV</Button>}
      />

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Job stage">
        {STAGES.map((st) => (
          <button
            key={st}
            type="button"
            role="tab"
            aria-selected={stage === st}
            onClick={() => setStage(st)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              stage === st ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {STAGE_LABEL[st]}
            <span className={cn("ml-1.5 tabular", stage === st ? "opacity-80" : "")}>{counts[st]}</span>
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

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When (BD)</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead className="hidden sm:table-cell">Job</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Sent</TableHead>
            <TableHead className="hidden sm:table-cell">Other cost</TableHead>
            <TableHead className="hidden sm:table-cell">Result</TableHead>
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
                  <div className="mt-1.5 flex flex-col items-start gap-1 whitespace-normal sm:hidden">
                    <span className="text-xs text-muted-foreground">{jobWord(i)} · balance {i.balance == null ? "–" : tk(i.balance)}</span>
                    {i.amount != null ? <span className="text-xs text-muted-foreground tabular">Sent {tk(i.amount)} · {i.kind === "taka" ? "commission" : "charge"} {tk(i.charge ?? 0)}</span> : null}
                    <CostLine cost={i.cost} note={i.cost_note} labelled />
                    <Badge tone={TONE[i.stage]}>{resultText(i)}</Badge>
                    {i.note ? <span className="text-xs text-muted-foreground">Your note: {i.note}</span> : null}
                    <Actions item={i} onDone={refresh} />
                  </div>
                </TableCell>
                <TableCell className="hidden align-top text-sm sm:table-cell">
                  {jobWord(i)}
                  {i.number ? <span className="block font-mono text-xs text-muted-foreground">to {i.number}</span> : null}
                  <span className="block text-xs text-muted-foreground tabular">balance {i.balance == null ? "–" : tk(i.balance)}</span>
                </TableCell>
                <TableCell className="hidden text-right align-top tabular sm:table-cell">
                  {i.amount == null ? "–" : tk(i.amount)}
                  {i.amount != null ? <span className="block text-xs text-muted-foreground">{i.kind === "taka" ? "comm." : "charge"} {tk(i.charge ?? 0)}</span> : null}
                </TableCell>
                <TableCell className="hidden whitespace-normal align-top sm:table-cell"><CostLine cost={i.cost} note={i.cost_note} /></TableCell>
                <TableCell className="hidden whitespace-normal align-top sm:table-cell">
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
    </Screen>
  );
}

const jobWord = (i: HistoryItem) => (i.kind === "taka" ? "Taka job" : "Crypto job");

/** What each partner sent in the Done rows of the chosen dates. */
function DoneTotals({ rows, nameOf }: { rows: HistoryItem[]; nameOf: (id: string) => string }) {
  const totals = totalsByPhone(rows);
  const all = totals.reduce((a, t) => ({ jobs: a.jobs + t.jobs, sent: a.sent + t.sent, charge: a.charge + t.charge, cost: a.cost + t.cost }), { jobs: 0, sent: 0, charge: 0, cost: 0 });
  return (
    <Card className="mb-4 p-4">
      <h3 className="mb-2 text-sm font-semibold">Done in these dates, by phone</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Phone</TableHead>
            <TableHead className="text-right">Jobs</TableHead>
            <TableHead className="text-right">Sent</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Comm. / charge</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Other cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {totals.map((t) => (
            <TableRow key={t.device_id}>
              <TableCell><DeviceChip id={t.device_id} name={nameOf(t.device_id)} /></TableCell>
              <TableCell className="text-right tabular">{t.jobs}</TableCell>
              <TableCell className="text-right tabular">{tk(t.sent)}</TableCell>
              <TableCell className="hidden text-right tabular sm:table-cell">{tk(t.charge)}</TableCell>
              <TableCell className="hidden text-right tabular sm:table-cell">{tk(t.cost)}</TableCell>
            </TableRow>
          ))}
          {totals.length > 1 ? (
            <TableRow>
              <TableCell className="font-semibold">All phones</TableCell>
              <TableCell className="text-right font-semibold tabular">{all.jobs}</TableCell>
              <TableCell className="text-right font-semibold tabular">{tk(all.sent)}</TableCell>
              <TableCell className="hidden text-right font-semibold tabular sm:table-cell">{tk(all.charge)}</TableCell>
              <TableCell className="hidden text-right font-semibold tabular sm:table-cell">{tk(all.cost)}</TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </Card>
  );
}

/** Accept / Reject a waiting job; cancel a Taka job that is still on the phone. A crypto job on the phone ends when the wallet's
 *  job is switched (Jobs page). */
function Actions({ item, onDone }: { item: HistoryItem; onDone: () => void }) {
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
      <div className="flex gap-1">
        <Confirm title="Accept this job?" description="Only do this after you have checked the money reached us. The job counts as done; PayTrace stops waiting for the wallet's message." confirmLabel="Accept" onConfirm={() => act("verified")}>
          <Button size="sm" variant="outline">Accept</Button>
        </Confirm>
        <Confirm title="Reject this job?" description="The partner will see that it was not accepted." confirmLabel="Reject" onConfirm={() => act("rejected")}>
          <Button size="sm" variant="ghost">Reject</Button>
        </Confirm>
      </div>
    );
  } else if (item.stage === "pending" && item.kind === "taka") {
    buttons = (
      <Confirm title="Take this job off the phone?" description="The partner will no longer see it. A new one starts with the next balance message that reaches the amount." confirmLabel="Cancel job" onConfirm={() => act("cancelled")}>
        <Button size="sm" variant="ghost">Cancel job</Button>
      </Confirm>
    );
  }
  if (!buttons) return null;
  return (
    <div className="flex flex-col items-start gap-1">
      {buttons}
      {problem ? <p role="alert" className="text-xs text-destructive">{problem}</p> : null}
    </div>
  );
}
