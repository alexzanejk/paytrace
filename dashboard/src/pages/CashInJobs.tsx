import { useState, type FormEvent } from "react";
import { Banknote } from "lucide-react";
import { must, sb } from "@/lib/supabase";
import { tk, when } from "@/lib/format";
import { useQuery } from "@/hooks/useQuery";
import { useDevices } from "@/hooks/useDevices";
import { CASHIN_LABEL, CASHIN_PROVIDERS, CASHIN_TONE, cashinCancellable, cashinSettleable, normalizeNumber, numberProblem, type CashinStatus } from "@/lib/cashin";
import { leftoverText, MAX_INSTRUCTION, parseThreshold, URGENCIES, URGENCY_LABEL, type Urgency } from "@/lib/jobs";
import { PROVIDER_LABEL } from "@/lib/types";
import { DeviceChip } from "@/components/DeviceChip";
import { Confirm } from "@/components/Confirm";
import { ProviderChip } from "@/components/ProviderChip";
import { EmptyRow } from "@/components/Empty";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Settings { enabled: boolean; threshold: number; urgency: Urgency; instruction: string }
interface NumberRow { id: string; provider: string; number: string; label: string | null; enabled: boolean; last_assigned_at: string | null }
interface JobRow {
  id: string; device_id: string; provider: string; number: string; balance: number | string; created_at: string; status: CashinStatus;
  amount: number | string | null; commission: number | string | null; submitted_at: string | null; attempts: number; diff: number | string | null; note: string | null;
}

/** Cash-in jobs: when a wallet's balance reaches the amount, the partner cashes in to one of these personal numbers (a number of the same wallet type,
 *  taken in turn) and types the amount and the cash-in commission the wallet gave; the next Cash Out message checks it. */
import { CashInCommandLimit } from "@/components/CashInCommandLimit";

export function CashInJobs() {
  const devices = useDevices();
  const { data, error, refresh } = useQuery(
    async () => {
      const s = must(await sb.from("cashin_settings").select("*").maybeSingle()) as { enabled: boolean; threshold: number | string; urgency: Urgency; instruction: string } | null;
      const numbers = must(await sb.from("cashin_numbers").select("*").order("provider").order("created_at")) as NumberRow[];
      const jobs = must(await sb.from("cashin_jobs").select("*").order("created_at", { ascending: false }).limit(30)) as JobRow[];
      const settings: Settings = {
        enabled: !!s?.enabled, threshold: Number(s?.threshold ?? 8000), urgency: s?.urgency ?? "urgent", instruction: s?.instruction ?? "",
      };
      return { settings, numbers, jobs };
    },
    [],
    { refreshMs: 20000 },
  );

  return (
    <section aria-labelledby="cashin-h">
      <h3 id="cashin-h" className="mb-1 mt-10 flex items-center gap-2 text-base font-semibold"><Banknote className="h-4 w-4" aria-hidden /> Cash-in jobs</h3>
      <p className="mb-3 text-sm text-muted-foreground">
        When a wallet's balance reaches the amount, the partner is asked to cash in to one of your personal numbers (a bKash wallet gets a bKash number, and so on; with
        several numbers they are used in turn). A cash-in sends no SMS, so the partner types the amount and the cash-in commission the wallet gave (for example Tk 0.38 on Tk 100).
        PayTrace checks the numbers against the next Cash Out message for that wallet.
      </p>
      {error ? <p role="alert" className="mb-3 text-sm text-destructive">{error}</p> : null}
      {data ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <CashInCommandLimit />
          <SettingsCard key={JSON.stringify(data.settings)} initial={data.settings} onSaved={refresh} />
          <NumbersCard numbers={data.numbers} onChanged={refresh} />
        </div>
      ) : null}

      <h4 className="mb-2 mt-6 text-sm font-semibold">Cash-in checks</h4>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When (BD)</TableHead>
            <TableHead>Agent</TableHead>
            <TableHead className="hidden sm:table-cell">Number</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Cash-in</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Commission</TableHead>
            <TableHead className="hidden sm:table-cell">Result</TableHead>
            <TableHead className="hidden sm:table-cell">Off by</TableHead>
            <TableHead className="hidden text-right sm:table-cell"><span className="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(data?.jobs ?? []).length === 0 ? (
            <EmptyRow cols={8} text="No cash-in job yet." />
          ) : (
            data!.jobs.map((j) => (
              <TableRow key={j.id}>
                <TableCell>{when(j.submitted_at ?? j.created_at)}</TableCell>
                <TableCell className="max-w-56">
                  <DeviceChip id={j.device_id} name={devices.nameOf(j.device_id)} />
                  <ProviderChip provider={j.provider} className="mt-0.5 flex text-xs" />
                  <div className="mt-1.5 flex flex-col items-start gap-1.5 sm:hidden">
                    <span className="font-mono text-xs text-muted-foreground">{j.number}</span>
                    {j.amount !== null ? <span className="text-xs text-muted-foreground tabular">Cash-in {tk(Number(j.amount))} · commission {tk(Number(j.commission ?? 0))}</span> : null}
                    <Badge tone={CASHIN_TONE[j.status]}>{CASHIN_LABEL[j.status]}</Badge>
                    <Actions job={j} onDone={refresh} />
                  </div>
                </TableCell>
                <TableCell className="hidden font-mono text-xs sm:table-cell">{j.number}</TableCell>
                <TableCell className="hidden text-right tabular sm:table-cell">{j.amount === null ? "–" : tk(Number(j.amount))}</TableCell>
                <TableCell className="hidden text-right tabular sm:table-cell">{j.commission === null ? "–" : tk(Number(j.commission))}</TableCell>
                <TableCell className="hidden sm:table-cell">
                  <Badge tone={CASHIN_TONE[j.status]}>{CASHIN_LABEL[j.status]}</Badge>
                  {j.note ? <span className="mt-0.5 block text-xs text-muted-foreground">{j.note}</span> : null}
                </TableCell>
                <TableCell className="hidden tabular sm:table-cell">{leftoverText(j.diff === null ? null : Number(j.diff))}</TableCell>
                <TableCell className="hidden text-right sm:table-cell"><Actions job={j} onDone={refresh} /></TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <p className="mt-2 text-xs text-muted-foreground">
        The wallet balance just before the cash-out must be: old balance − cash-in + cash-in commission. “Off by” is how far the cash-out message is from that. Nagad and Rocket print their
        cash-out commission, so the match is exact to the paisa; bKash does not, so a normal cash-out commission (0.30% to 0.60%) counts as a match.
      </p>
    </section>
  );
}

function Actions({ job, onDone }: { job: JobRow; onDone: () => void }) {
  const [problem, setProblem] = useState("");
  async function act(decision: "verified" | "rejected" | "cancelled") {
    setProblem("");
    const { error } = await sb.rpc("resolve_cashin_job", { p_id: job.id, p_decision: decision });
    if (error) setProblem(error.message);
    else onDone();
  }
  if (cashinSettleable(job.status)) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex gap-1">
          <Confirm title="Accept this cash-in?" description="Only do this after you have checked the wallet history yourself. The job will count as done." confirmLabel="Accept" onConfirm={() => act("verified")}>
            <Button size="sm" variant="outline">Accept</Button>
          </Confirm>
          <Confirm title="Reject this cash-in?" description="The partner will see that it was not accepted." confirmLabel="Reject" onConfirm={() => act("rejected")}>
            <Button size="sm" variant="ghost">Reject</Button>
          </Confirm>
        </div>
        {problem ? <p role="alert" className="text-xs text-destructive">{problem}</p> : null}
      </div>
    );
  }
  if (cashinCancellable(job.status)) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Confirm title="Cancel this job?" description="The partner will no longer see it. A new one can start with the next balance message." confirmLabel="Cancel job" onConfirm={() => act("cancelled")}>
          <Button size="sm" variant="ghost">Cancel job</Button>
        </Confirm>
        {problem ? <p role="alert" className="text-xs text-destructive">{problem}</p> : null}
      </div>
    );
  }
  return null;
}

function SettingsCard({ initial, onSaved }: { initial: Settings; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [threshold, setThreshold] = useState(String(initial.threshold));
  const [urgency, setUrgency] = useState<Urgency>(initial.urgency);
  const [instruction, setInstruction] = useState(initial.instruction);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState("");

  async function save(e: FormEvent) {
    e.preventDefault();
    setNote("");
    const amount = parseThreshold(threshold);
    if (!amount || amount <= 0) return setProblem("Type the amount in taka, for example 8000.");
    if (!instruction.trim()) return setProblem("Write what the partner should do.");
    setProblem("");
    setBusy(true);
    const { error } = await sb.rpc("set_cashin_settings", { p_enabled: enabled, p_threshold: amount, p_instruction: instruction.trim(), p_urgency: urgency });
    setBusy(false);
    if (error) return setProblem(error.message);
    setNote(enabled ? "Saved. Wallets at or above the amount will get a cash-in job within a minute." : "Saved. Cash-in jobs are off.");
    onSaved();
  }

  return (
    <Card>
      <CardHeader><CardTitle>When and what</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-4">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Cash-in jobs are {enabled ? "on" : "off"}</p>
              <p className="text-xs text-muted-foreground">Needs at least one number of the wallet's type below.</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Cash-in jobs on or off" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="cashin-amount">Start the job when a wallet's balance reaches (Tk)</Label>
              <Input id="cashin-amount" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>How urgent</Label>
              <Select value={urgency} onValueChange={(v) => setUrgency(v as Urgency)}>
                <SelectTrigger aria-label="Urgency"><SelectValue /></SelectTrigger>
                <SelectContent>{URGENCIES.map((u) => <SelectItem key={u} value={u}>{URGENCY_LABEL[u]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cashin-text">What should the partner do?</Label>
            <Textarea id="cashin-text" value={instruction} maxLength={MAX_INSTRUCTION} onChange={(e) => setInstruction(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              You can write <code>{"{agent}"}</code>, <code>{"{balance}"}</code>, <code>{"{provider}"}</code> and <code>{"{number}"}</code>. The number also shows in its own box with a Copy button.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
            {note ? <span className="text-sm text-muted-foreground">{note}</span> : null}
            {problem ? <span role="alert" className="text-sm text-destructive">{problem}</span> : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function NumbersCard({ numbers, onChanged }: { numbers: NumberRow[]; onChanged: () => void }) {
  const [provider, setProvider] = useState<string>("bkash");
  const [text, setText] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  async function add(e: FormEvent) {
    e.preventDefault();
    const bad = numberProblem(text);
    if (bad) return setProblem(bad);
    setProblem("");
    setBusy(true);
    const { error } = await sb.rpc("add_cashin_number", { p_provider: provider, p_number: normalizeNumber(text), p_label: label.trim() });
    setBusy(false);
    if (error) return setProblem(error.message);
    setText("");
    setLabel("");
    onChanged();
  }
  async function toggle(row: NumberRow) {
    const { error } = await sb.rpc("set_cashin_number_enabled", { p_id: row.id, p_enabled: !row.enabled });
    if (error) setProblem(error.message);
    else onChanged();
  }

  return (
    <Card>
      <CardHeader><CardTitle>Personal numbers to cash in to</CardTitle></CardHeader>
      <CardContent className="grid gap-4">
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)_minmax(0,9rem)_auto] sm:items-end">
          <div className="grid gap-1.5">
            <Label>Wallet type</Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger aria-label="Wallet type"><SelectValue /></SelectTrigger>
              <SelectContent>{CASHIN_PROVIDERS.map((p) => <SelectItem key={p} value={p}>{PROVIDER_LABEL[p]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cashin-number">Personal number</Label>
            <Input id="cashin-number" inputMode="tel" value={text} onChange={(e) => setText(e.target.value)} placeholder="01712345678" className="font-mono" autoComplete="off" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cashin-label">Note (optional)</Label>
            <Input id="cashin-label" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <Button type="submit" disabled={busy}>{busy ? "Adding…" : "Add"}</Button>
        </form>
        {problem ? <p role="alert" className="text-sm text-destructive">{problem}</p> : null}
        {numbers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No number yet. Add at least one for each wallet type you want cash-in jobs for.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {numbers.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm"><ProviderChip provider={n.provider} /> <span className="font-mono">{n.number}</span></p>
                  <p className="text-xs text-muted-foreground">
                    {n.label ? `${n.label} · ` : ""}{n.last_assigned_at ? `last given ${when(n.last_assigned_at)}` : "not given yet"}
                  </p>
                </div>
                <Switch checked={n.enabled} onCheckedChange={() => void toggle(n)} aria-label={`Use ${n.number}`} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
