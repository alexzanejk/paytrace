import { useState, type FormEvent } from "react";
import { Briefcase, Copy } from "lucide-react";
import { must, sb } from "@/lib/supabase";
import { tk, when } from "@/lib/format";
import { useQuery } from "@/hooks/useQuery";
import { useDevices } from "@/hooks/useDevices";
import { checkJobForm, cleanWallets, DEFAULT_THRESHOLD, fillTemplate, JOB_PROVIDERS, MAX_INSTRUCTION, parseThreshold, type JobProvider, type JobSettings } from "@/lib/jobs";
import { PROVIDER_LABEL } from "@/lib/types";
import { Screen } from "@/components/Screen";
import { PageHeader } from "@/components/PageHeader";
import { DeviceChip } from "@/components/DeviceChip";
import { ProviderChip } from "@/components/ProviderChip";
import { EmptyRow } from "@/components/Empty";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface OpenJob {
  device_id: string;
  provider: string;
  balance: number;
  balance_at: string;
  wallet: string | null;
}
interface Done {
  id: string;
  device_id: string;
  provider: string;
  balance: number | null;
  done_at: string;
}

export function Jobs() {
  const devices = useDevices();
  const { data, error, loading, refresh } = useQuery(
    async () => {
      const row = must(await sb.from("job_settings").select("*").maybeSingle()) as {
        enabled: boolean; threshold: number | string; instruction: string; wallets: Partial<Record<JobProvider, string>> | null;
      } | null;
      const open = must(await sb.from("device_open_jobs").select("*").order("balance", { ascending: false })) as OpenJob[];
      const done = must(await sb.from("job_completions").select("*").order("done_at", { ascending: false }).limit(20)) as Done[];
      const settings: JobSettings = {
        enabled: !!row?.enabled,
        threshold: Number(row?.threshold ?? DEFAULT_THRESHOLD),
        instruction: row?.instruction ?? "",
        wallets: row?.wallets ?? {},
      };
      return { settings, open, done };
    },
    [],
    { refreshMs: 20000 },
  );

  return (
    <Screen loading={loading || devices.loading} error={error ?? devices.error} hasData={!!data}>
      <PageHeader
        title="Jobs"
        description="Write the work once. When a phone's balance for a provider reaches the amount below, that phone's app shows it as “কাজ করুন এখনই” with the wallet address. The agent taps Done when finished."
      />
      {data ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <JobForm key={JSON.stringify(data.settings)} initial={data.settings} onSaved={refresh} />
          <Preview settings={data.settings} />
        </div>
      ) : null}

      <h3 className="mb-2 mt-8 text-base font-semibold">Jobs waiting right now</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Phone</TableHead>
            <TableHead>Provider</TableHead>
            <TableHead className="text-right">Balance</TableHead>
            <TableHead className="hidden sm:table-cell">Balance as of</TableHead>
            <TableHead className="hidden sm:table-cell">Wallet</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(data?.open ?? []).length === 0 ? (
            <EmptyRow cols={5} text="No phone has a job right now." />
          ) : (
            data!.open.map((j) => (
              <TableRow key={`${j.device_id}-${j.provider}`}>
                <TableCell className="max-w-48"><DeviceChip id={j.device_id} name={devices.nameOf(j.device_id)} /></TableCell>
                <TableCell><ProviderChip provider={j.provider} /></TableCell>
                <TableCell className="text-right tabular">{tk(j.balance)}</TableCell>
                <TableCell className="hidden sm:table-cell">{when(j.balance_at)}</TableCell>
                <TableCell className="hidden font-mono text-xs sm:table-cell">{j.wallet ?? "–"}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <p className="mt-2 text-xs text-muted-foreground">
        A phone's balance is the one printed in its newest payment message. After an agent taps Done, the job stays hidden until a newer
        balance message arrives, and comes back only if that balance is still at or above the amount.
      </p>

      <h3 className="mb-2 mt-8 text-base font-semibold">Marked done recently</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When (BD)</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead className="hidden sm:table-cell">Provider</TableHead>
            <TableHead className="text-right">Balance then</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(data?.done ?? []).length === 0 ? (
            <EmptyRow cols={4} text="Nothing has been marked done yet." />
          ) : (
            data!.done.map((d) => (
              <TableRow key={d.id}>
                <TableCell>{when(d.done_at)}</TableCell>
                <TableCell className="max-w-48">
                  <DeviceChip id={d.device_id} name={devices.nameOf(d.device_id)} />
                  <ProviderChip provider={d.provider} className="mt-0.5 flex text-xs sm:hidden" />
                </TableCell>
                <TableCell className="hidden sm:table-cell"><ProviderChip provider={d.provider} /></TableCell>
                <TableCell className="text-right tabular">{tk(d.balance)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Screen>
  );
}

function JobForm({ initial, onSaved }: { initial: JobSettings; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [threshold, setThreshold] = useState(String(initial.threshold));
  const [instruction, setInstruction] = useState(initial.instruction);
  const [wallets, setWallets] = useState<Partial<Record<JobProvider, string>>>(initial.wallets);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState("");

  async function save(e: FormEvent) {
    e.preventDefault();
    setNote("");
    const found = checkJobForm({ enabled, threshold, instruction, wallets });
    if (found.length > 0) return setProblem(found[0].message);
    setProblem("");
    setBusy(true);
    const { error } = await sb.rpc("set_job_settings", {
      p_enabled: enabled,
      p_threshold: parseThreshold(threshold),
      p_instruction: instruction.trim(),
      p_wallets: cleanWallets(wallets),
    });
    setBusy(false);
    if (error) return setProblem(error.message);
    setNote(enabled ? "Saved. Phones at or above the amount will see the job within a minute." : "Saved. Jobs are off.");
    onSaved();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Briefcase className="h-4 w-4" aria-hidden /> The job</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-5">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Jobs are {enabled ? "on" : "off"}</p>
              <p className="text-xs text-muted-foreground">Agents only see a job while this is on.</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Jobs on or off" />
          </div>

          <div className="grid gap-1.5 sm:max-w-xs">
            <Label htmlFor="job-amount">Show the job when the balance reaches (Tk)</Label>
            <Input id="job-amount" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="job-text">What should the agent do?</Label>
            <Textarea
              id="job-text"
              value={instruction}
              maxLength={MAX_INSTRUCTION}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="e.g. Send the money above Tk 1,000 to the wallet below now, then tap Done."
            />
            <p className="text-xs text-muted-foreground">
              You can write <code>{"{balance}"}</code> and <code>{"{provider}"}</code>; each agent sees their own balance and provider there.
              {" "}{instruction.length}/{MAX_INSTRUCTION}
            </p>
          </div>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Wallet address for the work</legend>
            <p className="text-xs text-muted-foreground">One per provider. A provider left empty gets no job.</p>
            {JOB_PROVIDERS.map((p) => (
              <div key={p} className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-3">
                <ProviderChip provider={p} />
                <Input
                  inputMode="numeric"
                  value={wallets[p] ?? ""}
                  onChange={(e) => setWallets((w) => ({ ...w, [p]: e.target.value }))}
                  placeholder="e.g. 01712345678"
                  aria-label={`${PROVIDER_LABEL[p]} wallet address`}
                />
              </div>
            ))}
          </fieldset>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save job"}</Button>
            {note ? <span className="text-sm text-muted-foreground">{note}</span> : null}
          </div>
          {problem ? <p role="alert" className="text-sm text-destructive">{problem}</p> : null}
        </form>
      </CardContent>
    </Card>
  );
}

/** A look at what the agent sees, with sample numbers. */
function Preview({ settings }: { settings: JobSettings }) {
  const first = JOB_PROVIDERS.find((p) => (settings.wallets[p] ?? "") !== "") ?? "bkash";
  const sample = Math.max(settings.threshold, DEFAULT_THRESHOLD) + 2000;
  const text = settings.instruction || "Your instruction appears here.";
  return (
    <div className="xl:sticky xl:top-4 xl:self-start">
      <p className="mb-2 text-sm font-medium">How it looks on the phone</p>
      <div className="rounded-3xl border border-border bg-muted/40 p-3">
        <div className="rounded-2xl border border-status-warn/40 bg-status-warn-bg p-4 text-status-warn">
          <p className="text-xl font-bold">কাজ করুন এখনই</p>
          <p className="mt-0.5 text-xs">{PROVIDER_LABEL[first]} balance {tk(sample)}</p>
          <div className="mt-3 rounded-xl bg-card p-3 text-sm text-card-foreground">{fillTemplate(text, first, sample)}</div>
          <p className="mt-3 text-xs font-medium">Wallet address</p>
          <div className="mt-1 flex items-center justify-between gap-2 rounded-xl bg-card p-3 text-card-foreground">
            <span className="font-mono text-base tracking-wide">{settings.wallets[first] || "01712345678"}</span>
            <span className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs"><Copy className="h-3 w-3" aria-hidden /> Copy</span>
          </div>
          <div className="mt-3 rounded-full bg-primary py-2 text-center text-sm font-medium text-primary-foreground">Done</div>
        </div>
      </div>
    </div>
  );
}
