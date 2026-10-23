import { useState, type FormEvent } from "react";
import { Briefcase, Copy } from "lucide-react";
import { must, sb } from "@/lib/supabase";
import { tk, when } from "@/lib/format";
import { useQuery } from "@/hooks/useQuery";
import { useDevices } from "@/hooks/useDevices";
import {
  addressOf, addressProblem, agentStatus, checkAgentForm, checkJobForm, DEFAULT_NETWORK, DEFAULT_THRESHOLD, fillTemplate, JOB_PROVIDERS, MAX_INSTRUCTION,
  networkProblem, parseThreshold, URGENCIES, URGENCY_LABEL, walletsFromAddress, type AgentForm, type JobProvider, type JobSettings, type Urgency,
} from "@/lib/jobs";
import { PROVIDER_LABEL } from "@/lib/types";
import { Screen } from "@/components/Screen";
import { PageHeader } from "@/components/PageHeader";
import { DeviceChip } from "@/components/DeviceChip";
import { Disclosure } from "@/components/Disclosure";
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

interface OpenJob {
  device_id: string;
  provider: string;
  balance: number;
  balance_at: string;
  wallet: string | null;
  urgency: Urgency;
  agent_name: string;
  network: string;
}
interface Done {
  id: string;
  device_id: string;
  provider: string;
  balance: number | null;
  done_at: string;
}
interface AgentRow {
  device_id: string;
  provider: string;
  agent_name: string | null;
  enabled: boolean;
  instruction: string | null;
  urgency: Urgency | null;
  wallet: string | null;
  network: string | null;
}
interface Balance {
  device_id: string;
  provider: string;
  balance: number;
  at: string;
}

const URGENCY_TONE = { normal: "idle", urgent: "warn", critical: "bad" } as const;

export function Jobs() {
  const devices = useDevices();
  const { data, error, loading, refresh } = useQuery(
    async () => {
      const row = must(await sb.from("job_settings").select("*").maybeSingle()) as {
        enabled: boolean; threshold: number | string; instruction: string; wallets: Partial<Record<JobProvider, string>> | null; urgency: Urgency | null; network: string | null;
      } | null;
      const open = must(await sb.from("device_open_jobs").select("*").order("balance", { ascending: false })) as OpenJob[];
      const done = must(await sb.from("job_completions").select("*").order("done_at", { ascending: false }).limit(20)) as Done[];
      const agents = must(await sb.from("agent_jobs").select("*")) as AgentRow[];
      const balances = must(await sb.from("device_balances").select("*")) as Balance[];
      const wallets = must(await sb.from("device_wallets").select("device_id,provider")) as { device_id: string; provider: string }[];
      const settings: JobSettings = {
        enabled: !!row?.enabled,
        threshold: Number(row?.threshold ?? DEFAULT_THRESHOLD),
        instruction: row?.instruction ?? "",
        wallets: row?.wallets ?? {},
        urgency: row?.urgency ?? "urgent",
        network: row?.network ?? DEFAULT_NETWORK,
      };
      return { settings, open, done, agents, balances, wallets };
    },
    [],
    { refreshMs: 20000 },
  );

  // An agent is one wallet on one phone: every wallet that has a balance, a deposit number or its own job.
  const approved = devices.list.filter((d) => d.status === "approved");
  const agents = approved.flatMap((d) =>
    JOB_PROVIDERS.filter(
      (p) =>
        (data?.balances ?? []).some((b) => b.device_id === d.id && b.provider === p) ||
        (data?.wallets ?? []).some((w) => w.device_id === d.id && w.provider === p) ||
        (data?.agents ?? []).some((a) => a.device_id === d.id && a.provider === p),
    ).map((p) => ({ device: d, provider: p })),
  );

  return (
    <Screen loading={loading || devices.loading} error={error ?? devices.error} hasData={!!data}>
      <PageHeader
        title="Jobs"
        description="An agent is one wallet on a phone (its bKash, Nagad, Rocket or Upay). When an agent's own balance reaches the amount, the phone shows that agent's job: “কাজ করুন এখনই”, what to do, how urgent, and your wallet address with its network. Write one default job, then change it for any agent."
      />
      {data ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <JobForm key={JSON.stringify(data.settings)} initial={data.settings} onSaved={refresh} />
          <Preview settings={data.settings} />
        </div>
      ) : null}

      <h3 className="mb-1 mt-8 text-base font-semibold">Agents</h3>
      <p className="mb-3 text-sm text-muted-foreground">Each card is one agent. Leave a field empty to use the default job above.</p>
      {agents.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">No agent yet. An agent appears here once its phone has sent a payment message with a balance.</Card>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">
          {agents.map(({ device, provider }) => {
            const row = (data?.agents ?? []).find((a) => a.device_id === device.id && a.provider === provider);
            const bal = (data?.balances ?? []).find((b) => b.device_id === device.id && b.provider === provider);
            const showing = (data?.open ?? []).find((j) => j.device_id === device.id && j.provider === provider);
            return (
              <AgentCard
                key={`${device.id}-${provider}-${row?.agent_name ?? ""}-${row?.urgency ?? ""}-${row?.wallet ?? ""}-${row?.instruction ?? ""}-${row?.enabled}`}
                deviceId={device.id}
                phoneName={devices.nameOf(device.id)}
                provider={provider}
                row={row}
                balance={bal ? Number(bal.balance) : null}
                balanceAt={bal?.at ?? null}
                showing={!!showing}
                settings={data!.settings}
                onSaved={refresh}
              />
            );
          })}
        </div>
      )}

      <h3 className="mb-2 mt-8 text-base font-semibold">Jobs showing right now</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Agent</TableHead>
            <TableHead className="hidden sm:table-cell">Urgency</TableHead>
            <TableHead className="text-right">Balance</TableHead>
            <TableHead className="hidden sm:table-cell">Balance as of</TableHead>
            <TableHead className="hidden sm:table-cell">Wallet</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(data?.open ?? []).length === 0 ? (
            <EmptyRow cols={5} text="No agent has a job right now." />
          ) : (
            data!.open.map((j) => (
              <TableRow key={`${j.device_id}-${j.provider}`}>
                <TableCell className="max-w-56">
                  <span className="font-medium">{j.agent_name}</span>
                  <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <ProviderChip provider={j.provider} />
                    <Badge tone={URGENCY_TONE[j.urgency]} className="sm:hidden">{URGENCY_LABEL[j.urgency]}</Badge>
                  </span>
                </TableCell>
                <TableCell className="hidden sm:table-cell"><Badge tone={URGENCY_TONE[j.urgency]}>{URGENCY_LABEL[j.urgency]}</Badge></TableCell>
                <TableCell className="text-right tabular">{tk(j.balance)}</TableCell>
                <TableCell className="hidden sm:table-cell">{when(j.balance_at)}</TableCell>
                <TableCell className="hidden font-mono text-xs sm:table-cell">{j.wallet ?? "–"}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <p className="mt-2 text-xs text-muted-foreground">
        An agent's balance is the one printed in its wallet's newest payment message. After the agent taps Done, the job stays hidden until a newer
        balance message arrives, and comes back only if that balance is still at or above the amount.
      </p>

      <h3 className="mb-2 mt-8 text-base font-semibold">Marked done recently</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When (BD)</TableHead>
            <TableHead>Agent</TableHead>
            <TableHead className="text-right">Balance then</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(data?.done ?? []).length === 0 ? (
            <EmptyRow cols={3} text="Nothing has been marked done yet." />
          ) : (
            data!.done.map((d) => (
              <TableRow key={d.id}>
                <TableCell>{when(d.done_at)}</TableCell>
                <TableCell className="max-w-56">
                  <DeviceChip id={d.device_id} name={devices.nameOf(d.device_id)} />
                  <ProviderChip provider={d.provider} className="mt-0.5 flex text-xs" />
                </TableCell>
                <TableCell className="text-right tabular">{tk(d.balance)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Screen>
  );
}

function UrgencySelect({ value, onChange, withDefault, defaultLabel }: { value: string; onChange: (v: string) => void; withDefault?: boolean; defaultLabel?: string }) {
  return (
    <Select value={value || "default"} onValueChange={(v) => onChange(v === "default" ? "" : v)}>
      <SelectTrigger aria-label="Urgency"><SelectValue /></SelectTrigger>
      <SelectContent>
        {withDefault ? <SelectItem value="default">{defaultLabel ?? "Default"}</SelectItem> : null}
        {URGENCIES.map((u) => <SelectItem key={u} value={u}>{URGENCY_LABEL[u]}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function JobForm({ initial, onSaved }: { initial: JobSettings; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [threshold, setThreshold] = useState(String(initial.threshold));
  const [instruction, setInstruction] = useState(initial.instruction);
  const [urgency, setUrgency] = useState<Urgency>(initial.urgency);
  const [address, setAddress] = useState(addressOf(initial.wallets));
  const [network, setNetwork] = useState(initial.network);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState("");

  async function save(e: FormEvent) {
    e.preventDefault();
    setNote("");
    const found = checkJobForm({ enabled, threshold, instruction, wallets: walletsFromAddress(address) });
    const bad = addressProblem(address) ?? networkProblem(network) ?? found[0]?.message ?? null;
    if (bad) return setProblem(bad);
    setProblem("");
    setBusy(true);
    const { error } = await sb.rpc("set_job_settings", {
      p_enabled: enabled,
      p_threshold: parseThreshold(threshold),
      p_instruction: instruction.trim(),
      p_wallets: walletsFromAddress(address),
      p_urgency: urgency,
      p_network: network.trim(),
    });
    setBusy(false);
    if (error) return setProblem(error.message);
    setNote(enabled ? "Saved. Agents at or above the amount will see the job within a minute." : "Saved. Jobs are off.");
    onSaved();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Briefcase className="h-4 w-4" aria-hidden /> The default job</CardTitle>
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="job-amount">Show the job when an agent's balance reaches (Tk)</Label>
              <Input id="job-amount" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>How urgent</Label>
              <UrgencySelect value={urgency} onChange={(v) => setUrgency(v as Urgency)} />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="job-text">What should the agent do?</Label>
            <Textarea
              id="job-text"
              value={instruction}
              maxLength={MAX_INSTRUCTION}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="e.g. Send the money above Tk 1,000 to the wallet address below, on the network shown, then tap Done."
            />
            <p className="text-xs text-muted-foreground">
              You can write <code>{"{agent}"}</code>, <code>{"{balance}"}</code> and <code>{"{provider}"}</code>; each agent sees their own name, balance and wallet type there.
              {" "}{instruction.length}/{MAX_INSTRUCTION}
            </p>
          </div>

          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="job-address">Wallet address to send to (your Trust Wallet)</Label>
              <Input
                id="job-address"
                value={address}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => setAddress(e.target.value)}
                placeholder="0x…"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">Paste it from Trust Wallet. Every agent sees this address unless you give that agent its own below.</p>
            </div>
            <div className="grid gap-1.5 sm:max-w-xs">
              <Label htmlFor="job-network">Network</Label>
              <Input id="job-network" value={network} onChange={(e) => setNetwork(e.target.value)} />
              <p className="text-xs text-muted-foreground">Shown next to the address.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save default job"}</Button>
            {note ? <span className="text-sm text-muted-foreground">{note}</span> : null}
          </div>
          {problem ? <p role="alert" className="text-sm text-destructive">{problem}</p> : null}
        </form>
      </CardContent>
    </Card>
  );
}

/** One agent: where it stands, and (folded away) its own description, urgency and wallet address. */
function AgentCard({
  deviceId, phoneName, provider, row, balance, balanceAt, showing, settings, onSaved,
}: {
  deviceId: string; phoneName: string; provider: JobProvider; row: AgentRow | undefined; balance: number | null; balanceAt: string | null;
  showing: boolean; settings: JobSettings; onSaved: () => void;
}) {
  const [form, setForm] = useState<AgentForm>({
    name: row?.agent_name ?? "", instruction: row?.instruction ?? "", urgency: row?.urgency ?? "", wallet: row?.wallet ?? "", network: row?.network ?? "",
  });
  const [on, setOn] = useState(row?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState("");
  const own = !!(row && (row.instruction || row.urgency || row.wallet || row.network));

  async function save(next: { form: AgentForm; on: boolean }) {
    setNote("");
    const bad = checkAgentForm(next.form);
    if (bad) return setProblem(bad);
    setProblem("");
    setBusy(true);
    const { error } = await sb.rpc("set_agent_job", {
      p_device: deviceId,
      p_provider: provider,
      p_agent_name: next.form.name.trim(),
      p_enabled: next.on,
      p_instruction: next.form.instruction.trim(),
      p_urgency: next.form.urgency,
      p_wallet: next.form.wallet.trim(),
      p_network: next.form.network.trim(),
    });
    setBusy(false);
    if (error) return setProblem(error.message);
    setNote("Saved.");
    onSaved();
  }

  const status = agentStatus({
    jobsOn: settings.enabled, agentOn: on, balance, threshold: settings.threshold,
    hasWallet: !!(form.wallet.trim() || settings.wallets[provider]), showing,
  });
  const tone = showing ? "warn" : status === "Below the amount" ? "ok" : "idle";

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="flex flex-wrap items-center gap-x-2 text-base font-semibold">
            {form.name.trim() || phoneName}
            <ProviderChip provider={provider} className="text-sm font-normal" />
          </h4>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Phone: {phoneName} · balance {balance === null ? "–" : tk(balance)}{balanceAt ? ` (${when(balanceAt)})` : ""}
          </p>
        </div>
        <Badge tone={tone} className="shrink-0">{status}</Badge>
      </div>

      <Disclosure icon={Briefcase} title="This agent's job" summary={own ? "Own job" : "Using the default job"}>
        <div className="grid gap-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Jobs for this agent are {on ? "on" : "off"}</p>
              <p className="text-xs text-muted-foreground">Switch off to give this agent no job at all.</p>
            </div>
            <Switch checked={on} onCheckedChange={setOn} aria-label={`Jobs on for ${form.name.trim() || phoneName} ${PROVIDER_LABEL[provider]}`} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`an-${deviceId}-${provider}`}>Agent name (shown on the phone)</Label>
            <Input id={`an-${deviceId}-${provider}`} value={form.name} maxLength={40} placeholder={phoneName} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`ai-${deviceId}-${provider}`}>What should this agent do?</Label>
            <Textarea
              id={`ai-${deviceId}-${provider}`}
              value={form.instruction}
              maxLength={MAX_INSTRUCTION}
              placeholder={settings.instruction || "Uses the default job's text"}
              onChange={(e) => setForm((f) => ({ ...f, instruction: e.target.value }))}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>How urgent</Label>
              <UrgencySelect value={form.urgency} withDefault defaultLabel={`Default (${URGENCY_LABEL[settings.urgency]})`} onChange={(v) => setForm((f) => ({ ...f, urgency: v as "" | Urgency }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`aw-${deviceId}-${provider}`}>Wallet address</Label>
              <Input
                id={`aw-${deviceId}-${provider}`}
                value={form.wallet}
                spellCheck={false}
                autoComplete="off"
                className="font-mono"
                placeholder={settings.wallets[provider] || "Paste the wallet address"}
                onChange={(e) => setForm((f) => ({ ...f, wallet: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`anw-${deviceId}-${provider}`}>Network</Label>
            <Input
              id={`anw-${deviceId}-${provider}`}
              value={form.network}
              placeholder={settings.network}
              onChange={(e) => setForm((f) => ({ ...f, network: e.target.value }))}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={busy} onClick={() => void save({ form, on })}>{busy ? "Saving…" : "Save this agent"}</Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !own}
              onClick={() => {
                const cleared: AgentForm = { name: form.name, instruction: "", urgency: "", wallet: "", network: "" };
                setForm(cleared);
                void save({ form: cleared, on });
              }}
            >
              Use the default job
            </Button>
            {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
          </div>
          {problem ? <p role="alert" className="text-xs text-destructive">{problem}</p> : null}
        </div>
      </Disclosure>
    </Card>
  );
}

/** A look at what the agent sees, with sample numbers. */
function Preview({ settings }: { settings: JobSettings }) {
  const first = JOB_PROVIDERS.find((p) => (settings.wallets[p] ?? "") !== "") ?? "bkash";
  const sample = Math.max(settings.threshold, DEFAULT_THRESHOLD) + 2000;
  const text = settings.instruction || "Your instruction appears here.";
  const tone =
    settings.urgency === "critical"
      ? "border-status-bad/40 bg-status-bad-bg text-status-bad"
      : settings.urgency === "urgent"
        ? "border-status-warn/40 bg-status-warn-bg text-status-warn"
        : "border-border bg-muted text-foreground";
  return (
    <div className="xl:sticky xl:top-4 xl:self-start">
      <p className="mb-2 text-sm font-medium">How it looks on the phone</p>
      <div className="rounded-3xl border border-border bg-muted/40 p-3">
        <div className={`rounded-2xl border p-4 ${tone}`}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-xl font-bold">কাজ করুন এখনই</p>
            <Badge tone={URGENCY_TONE[settings.urgency]}>{URGENCY_LABEL[settings.urgency]}</Badge>
          </div>
          <p className="mt-0.5 text-xs">Karim · {PROVIDER_LABEL[first]} balance {tk(sample)}</p>
          <div className="mt-3 rounded-xl bg-card p-3 text-sm text-card-foreground">{fillTemplate(text, first, sample, "Karim")}</div>
          <p className="mt-3 text-xs font-medium">Wallet address</p>
          <div className="mt-1 flex items-center justify-between gap-2 rounded-xl bg-card p-3 text-card-foreground">
            <span className="min-w-0 break-all font-mono text-sm tracking-wide">{settings.wallets[first] || "0x71C7…976F"}</span>
            <span className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs"><Copy className="h-3 w-3" aria-hidden /> Copy</span>
          </div>
          <p className="mt-2 text-xs"><span className="font-medium">Network:</span> {settings.network}</p>
          <p className="text-xs opacity-80">Send only on this network, or the money can be lost.</p>
          <div className="mt-3 rounded-full bg-primary py-2 text-center text-sm font-medium text-primary-foreground">Done</div>
        </div>
      </div>
    </div>
  );
}
