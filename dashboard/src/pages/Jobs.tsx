import { useState, type FormEvent } from "react";
import { Banknote, Bitcoin, ClipboardCheck, Copy, UserRound } from "lucide-react";
import { must, sb } from "@/lib/supabase";
import { tk, when } from "@/lib/format";
import { useQuery } from "@/hooks/useQuery";
import { useDevices } from "@/hooks/useDevices";
import {
  addressOf, addressProblem, checkAgentForm, checkJobForm, DEFAULT_NETWORK, DEFAULT_THRESHOLD, fillTemplate, JOB_PROVIDERS, leftoverText, MAX_INSTRUCTION,
  networkProblem, TRANSFER_LABEL, TRANSFER_TONE, transferOpen, URGENCIES, URGENCY_LABEL, walletsFromAddress,
  type AgentForm, type JobProvider, type JobSettings, type TransferStatus, type Urgency,
} from "@/lib/jobs";
import { defaultLabel, JOB_KINDS, KIND_LABEL, KIND_SHORT, standing, wantFor, type JobKind, type WalletJobRow, type WalletJobRule } from "@/lib/walletJobs";
import { PROVIDER_LABEL } from "@/lib/types";
import { CashInChecks, TakaJobSettings } from "@/pages/CashInJobs";
import { Screen } from "@/components/Screen";
import { PageHeader } from "@/components/PageHeader";
import { DeviceChip } from "@/components/DeviceChip";
import { Confirm } from "@/components/Confirm";
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
import { cn } from "@/lib/utils";

interface TransferRow {
  id: string; device_id: string; provider: string; amount: number; charge: number; base_balance: number; status: TransferStatus;
  attempts: number; diff: number | null; submitted_at: string; checked_at: string | null; note: string | null;
}
interface AgentRow {
  device_id: string; provider: string; agent_name: string | null; enabled: boolean; instruction: string | null; urgency: Urgency | null;
  wallet: string | null; network: string | null;
}

const URGENCY_TONE = { normal: "idle", urgent: "warn", critical: "bad" } as const;
const TONE_CLASS = { ok: "text-status-ok", warn: "text-status-warn", bad: "text-status-bad", idle: "text-muted-foreground" } as const;

/** Jobs, rebuilt (owner 2026-11-08: "very messy ... we should be able to change any time from the dashboard the job, from crypto to
 *  taka, and the amount, for any device"). Every phone's wallet has ONE job, shown in one table: Taka (send to one of our saved
 *  numbers) or Crypto (send to our crypto wallet), from an amount; each wallet type has a default. Everything else (the crypto
 *  address, our numbers, the texts, the partners' checks) is folded below. */
export function Jobs() {
  const devices = useDevices();
  const { data, error, loading, refresh } = useQuery(
    async () => {
      const row = must(await sb.from("job_settings").select("*").maybeSingle()) as {
        enabled: boolean; threshold: number | string; instruction: string; wallets: Partial<Record<JobProvider, string>> | null; urgency: Urgency | null; network: string | null;
      } | null;
      const cash = must(await sb.from("cashin_settings").select("enabled").maybeSingle()) as { enabled: boolean } | null;
      const wallets = must(await sb.rpc("admin_wallet_jobs")) as WalletJobRow[];
      const rules = must(await sb.from("wallet_job_rules").select("provider,kind,threshold").order("provider")) as WalletJobRule[];
      const transfers = must(await sb.from("job_transfers").select("*").order("submitted_at", { ascending: false }).limit(30)) as TransferRow[];
      const agents = must(await sb.from("agent_jobs").select("*")) as AgentRow[];
      const settings: JobSettings = {
        enabled: !!row?.enabled,
        threshold: Number(row?.threshold ?? DEFAULT_THRESHOLD),
        instruction: row?.instruction ?? "",
        wallets: row?.wallets ?? {},
        urgency: row?.urgency ?? "urgent",
        network: row?.network ?? DEFAULT_NETWORK,
      };
      return { settings, jobsOn: !!row?.enabled && !!cash?.enabled, wallets, rules, transfers, agents };
    },
    [],
    { refreshMs: 20000 },
  );

  const byPhone = new Map<string, WalletJobRow[]>();
  for (const w of data?.wallets ?? []) byPhone.set(w.device_id, [...(byPhone.get(w.device_id) ?? []), w]);
  const waitingChecks = (data?.transfers ?? []).filter((t) => transferOpen(t.status)).length;

  return (
    <Screen loading={loading || devices.loading} error={error ?? devices.error} hasData={!!data}>
      <PageHeader
        title="Jobs"
        description="Each wallet on each phone has one job. When the wallet's own money reaches its amount, the phone rings and shows it: Taka = send the money to one of our saved bKash / Nagad numbers; Crypto = send it to our crypto wallet. Change any wallet's job or amount below, any time."
      />
      {data ? (
        <div className="grid gap-6">
          <MasterSwitch on={data.jobsOn} onChanged={refresh} />

          <section aria-labelledby="wallets-h">
            <h3 id="wallets-h" className="mb-1 text-base font-semibold">Each wallet's job</h3>
            <p className="mb-3 text-sm text-muted-foreground">Pick the job and, if you like, this wallet's own amount. Leave the amount empty to use the wallet type's default (set further down).</p>
            {byPhone.size === 0 ? (
              <Card className="p-6 text-center text-sm text-muted-foreground">No wallet yet. A wallet appears once its phone has sent a payment message or its number is saved in the app.</Card>
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                {[...byPhone.entries()].map(([deviceId, rows]) => (
                  <Card key={deviceId} className="p-4">
                    <h4 className="mb-3 text-base font-semibold"><DeviceChip id={deviceId} name={devices.nameOf(deviceId)} /></h4>
                    <div className="divide-y divide-border">
                      {rows.map((r) => (
                        <WalletJobLine
                          key={`${r.provider}-${r.kind}-${r.kind_own}-${r.threshold}-${r.threshold_own}`}
                          row={r}
                          rule={data.rules.find((x) => x.provider === r.provider)}
                          jobsOn={data.jobsOn}
                          onSaved={refresh}
                        />
                      ))}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>

          <section aria-labelledby="defaults-h">
            <h3 id="defaults-h" className="mb-1 text-base font-semibold">Defaults for each wallet type</h3>
            <p className="mb-3 text-sm text-muted-foreground">Every wallet uses these unless you chose something else for it above.</p>
            <Card className="divide-y divide-border p-0">
              {JOB_PROVIDERS.map((p) => {
                const rule = data.rules.find((x) => x.provider === p);
                return rule ? <DefaultLine key={`${p}-${rule.kind}-${rule.threshold}`} rule={rule} onSaved={refresh} /> : null;
              })}
            </Card>
          </section>

          <div className="grid gap-3">
            <Disclosure
              icon={ClipboardCheck}
              title="Did the partners really do it? (checks)"
              summary={waitingChecks ? `${waitingChecks} crypto send${waitingChecks === 1 ? "" : "s"} waiting for you` : "Crypto sends and Taka sends, with Accept / Reject"}
            >
              <h4 className="mb-2 text-sm font-semibold">Crypto job: sends</h4>
              <TransfersTable rows={data.transfers} nameOf={devices.nameOf} onDone={refresh} />
              <h4 className="mb-2 mt-6 text-sm font-semibold">Taka job: sends to our numbers</h4>
              <CashInChecks />
            </Disclosure>
            <Disclosure icon={Banknote} title="Taka job: our numbers and the text" summary="Where the partners send the taka">
              <TakaJobSettings />
            </Disclosure>
            <Disclosure icon={Bitcoin} title="Crypto job: wallet address, network and the text" summary={data.settings.network}>
              <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
                <CryptoJobForm key={JSON.stringify(data.settings)} initial={data.settings} onSaved={refresh} />
                <Preview settings={data.settings} />
              </div>
            </Disclosure>
            <Disclosure icon={UserRound} title="Names and own texts per wallet" summary="Optional: a partner's name, text, urgency or crypto address">
              <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">
                {(data.wallets ?? []).map((w) => {
                  const row = data.agents.find((a) => a.device_id === w.device_id && a.provider === w.provider);
                  return (
                    <AgentCard
                      key={`${w.device_id}-${w.provider}-${row?.agent_name ?? ""}-${row?.urgency ?? ""}-${row?.wallet ?? ""}-${row?.instruction ?? ""}-${row?.network ?? ""}`}
                      deviceId={w.device_id}
                      phoneName={devices.nameOf(w.device_id)}
                      provider={w.provider as JobProvider}
                      row={row}
                      settings={data.settings}
                      onSaved={refresh}
                    />
                  );
                })}
              </div>
            </Disclosure>
          </div>
        </div>
      ) : null}
    </Screen>
  );
}

/** One switch for every job on every phone (both kinds). */
function MasterSwitch({ on, onChanged }: { on: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  async function set(next: boolean) {
    setBusy(true);
    setProblem("");
    const { error } = await sb.rpc("set_jobs_enabled", { p_on: next });
    setBusy(false);
    if (error) setProblem(error.message);
    else onChanged();
  }
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div>
        <p className="text-sm font-semibold">Jobs are {on ? "ON" : "OFF"}</p>
        <p className="text-xs text-muted-foreground">{on ? "Phones show a wallet's job once its money reaches the amount." : "No phone shows any job while this is off."}</p>
        {problem ? <p role="alert" className="text-xs text-destructive">{problem}</p> : null}
      </div>
      <Switch checked={on} disabled={busy} onCheckedChange={(v) => void set(v)} aria-label="Jobs on or off for every phone" />
    </Card>
  );
}

/** One wallet on one phone: its money, its job and its amount, saved with one button. */
function WalletJobLine({ row, rule, jobsOn, onSaved }: { row: WalletJobRow; rule: WalletJobRule | undefined; jobsOn: boolean; onSaved: () => void }) {
  const [kind, setKind] = useState<JobKind | "default">(row.kind_own ? row.kind : "default");
  const [amount, setAmount] = useState(row.threshold_own ? String(Number(row.threshold)) : "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const changed = kind !== (row.kind_own ? row.kind : "default") || amount.trim() !== (row.threshold_own ? String(Number(row.threshold)) : "");
  const st = standing(row, jobsOn);

  async function save() {
    const want = wantFor(kind, amount);
    if (want.problem) return setProblem(want.problem);
    setProblem("");
    setBusy(true);
    const { error } = await sb.rpc("set_wallet_job", { p_device: row.device_id, p_provider: row.provider, p_kind: want.kind, p_threshold: want.threshold });
    setBusy(false);
    if (error) return setProblem(error.message);
    onSaved();
  }

  return (
    <div className="grid gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <ProviderChip provider={row.provider} />
        <span className="text-xs text-muted-foreground tabular">
          {row.own_money == null ? "no balance yet" : `own money ${tk(Number(row.own_money))}`}
          {row.balance_at ? ` · ${when(row.balance_at)}` : ""}
        </span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto]">
        <Select value={kind} onValueChange={(v) => setKind(v as JobKind | "default")}>
          <SelectTrigger className="col-span-2 sm:col-span-1" aria-label={`Job for ${PROVIDER_LABEL[row.provider as JobProvider] ?? row.provider}`}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="default">{defaultLabel(rule)}</SelectItem>
            {JOB_KINDS.map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={`from ${Number(rule?.threshold ?? row.threshold).toLocaleString("en-IN")}`}
          aria-label="Start the job at (Tk)"
          disabled={kind === "off"}
        />
        <Button size="sm" disabled={busy || !changed} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Button>
      </div>
      <p className={cn("text-xs", TONE_CLASS[st.tone])}>
        {KIND_SHORT[row.kind]}{row.kind === "off" ? "" : ` from ${tk(Number(row.threshold))}`} · {st.text}
      </p>
      {problem ? <p role="alert" className="text-xs text-destructive">{problem}</p> : null}
    </div>
  );
}

/** One wallet type's default job and amount. */
function DefaultLine({ rule, onSaved }: { rule: WalletJobRule; onSaved: () => void }) {
  const [kind, setKind] = useState<JobKind>(rule.kind);
  const [amount, setAmount] = useState(String(Number(rule.threshold)));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const changed = kind !== rule.kind || amount.trim() !== String(Number(rule.threshold));

  async function save(e: FormEvent) {
    e.preventDefault();
    const want = wantFor(kind, amount);
    if (want.problem || want.threshold === null) return setProblem(want.problem || "Type the amount in taka, at least 100.");
    setProblem("");
    setBusy(true);
    const { error } = await sb.rpc("set_wallet_job_rule", { p_provider: rule.provider, p_kind: kind, p_threshold: want.threshold });
    setBusy(false);
    if (error) return setProblem(error.message);
    onSaved();
  }

  return (
    <form onSubmit={save} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 p-4 sm:grid-cols-[6rem_minmax(0,1fr)_9rem_auto]">
      <ProviderChip provider={rule.provider} className="col-span-2 sm:col-span-1" />
      <Select value={kind} onValueChange={(v) => setKind(v as JobKind)}>
        <SelectTrigger className="col-span-2 sm:col-span-1" aria-label={`Default job for ${rule.provider}`}><SelectValue /></SelectTrigger>
        <SelectContent>{JOB_KINDS.map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}</SelectContent>
      </Select>
      <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Default amount (Tk)" disabled={kind === "off"} />
      <Button size="sm" type="submit" disabled={busy || !changed}>{busy ? "Saving…" : "Save"}</Button>
      {problem ? <p role="alert" className="col-span-2 text-xs text-destructive sm:col-span-4">{problem}</p> : null}
    </form>
  );
}

function TransfersTable({ rows, nameOf, onDone }: { rows: TransferRow[]; nameOf: (id: string) => string; onDone: () => void }) {
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When (BD)</TableHead>
            <TableHead>Wallet</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Sent</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Charge</TableHead>
            <TableHead className="hidden sm:table-cell">Result</TableHead>
            <TableHead className="hidden sm:table-cell">Off by</TableHead>
            <TableHead className="hidden text-right sm:table-cell"><span className="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <EmptyRow cols={7} text="No partner has submitted a send yet." />
          ) : (
            rows.map((t) => (
              <TableRow key={t.id}>
                <TableCell>{when(t.submitted_at)}</TableCell>
                <TableCell className="max-w-56">
                  <DeviceChip id={t.device_id} name={nameOf(t.device_id)} />
                  <ProviderChip provider={t.provider} className="mt-0.5 flex text-xs" />
                  <div className="mt-1.5 flex flex-col items-start gap-1.5 sm:hidden">
                    <span className="text-xs text-muted-foreground tabular">Sent {tk(Number(t.amount))} · charge {tk(Number(t.charge))}</span>
                    <Badge tone={TRANSFER_TONE[t.status]}>{TRANSFER_LABEL[t.status]}</Badge>
                    {transferOpen(t.status) ? <SettleButtons id={t.id} onDone={onDone} /> : null}
                  </div>
                </TableCell>
                <TableCell className="hidden text-right tabular sm:table-cell">{tk(Number(t.amount))}</TableCell>
                <TableCell className="hidden text-right tabular sm:table-cell">{tk(Number(t.charge))}</TableCell>
                <TableCell className="hidden sm:table-cell">
                  <Badge tone={TRANSFER_TONE[t.status]}>{TRANSFER_LABEL[t.status]}</Badge>
                  {t.note ? <span className="mt-0.5 block text-xs text-muted-foreground">{t.note}</span> : null}
                </TableCell>
                <TableCell className="hidden tabular sm:table-cell">{leftoverText(t.diff === null ? null : Number(t.diff))}</TableCell>
                <TableCell className="hidden text-right sm:table-cell">{transferOpen(t.status) ? <SettleButtons id={t.id} onDone={onDone} /> : null}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <p className="mt-2 text-xs text-muted-foreground">
        After sending, the partner types the amount and the charge in the app; PayTrace checks the wallet's next Cash Out message against it. For bKash, which does not
        print its commission, a normal commission (0.30% to 0.60%) counts as a match.
      </p>
    </>
  );
}

function SettleButtons({ id, onDone }: { id: string; onDone: () => void }) {
  const [problem, setProblem] = useState("");
  async function settle(decision: "verified" | "rejected") {
    setProblem("");
    const { error } = await sb.rpc("resolve_job_transfer", { p_id: id, p_decision: decision });
    if (error) setProblem(error.message);
    else onDone();
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        <Confirm title="Accept this send?" description="Only do this after you have checked your own wallet history. The job will count as done." confirmLabel="Accept" onConfirm={() => settle("verified")}>
          <Button size="sm" variant="outline">Accept</Button>
        </Confirm>
        <Confirm title="Reject this send?" description="The partner will see that it was not accepted. The job comes back with the next balance message if it is still above the amount." confirmLabel="Reject" onConfirm={() => settle("rejected")}>
          <Button size="sm" variant="ghost">Reject</Button>
        </Confirm>
      </div>
      {problem ? <p role="alert" className="text-xs text-destructive">{problem}</p> : null}
    </div>
  );
}

function UrgencySelect({ value, onChange, withDefault, defaultLabel: dl }: { value: string; onChange: (v: string) => void; withDefault?: boolean; defaultLabel?: string }) {
  return (
    <Select value={value || "default"} onValueChange={(v) => onChange(v === "default" ? "" : v)}>
      <SelectTrigger aria-label="Urgency"><SelectValue /></SelectTrigger>
      <SelectContent>
        {withDefault ? <SelectItem value="default">{dl ?? "Default"}</SelectItem> : null}
        {URGENCIES.map((u) => <SelectItem key={u} value={u}>{URGENCY_LABEL[u]}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** The crypto job's address, network, text and urgency. WHEN it starts is chosen per wallet above; the on/off switch is at the top. */
function CryptoJobForm({ initial, onSaved }: { initial: JobSettings; onSaved: () => void }) {
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
    const found = checkJobForm({ enabled: initial.enabled, threshold: String(initial.threshold), instruction, wallets: walletsFromAddress(address) });
    const bad = addressProblem(address) ?? networkProblem(network) ?? found[0]?.message ?? null;
    if (bad) return setProblem(bad);
    setProblem("");
    setBusy(true);
    const { error } = await sb.rpc("set_job_settings", {
      p_enabled: initial.enabled, p_threshold: initial.threshold, p_instruction: instruction.trim(),
      p_wallets: walletsFromAddress(address), p_urgency: urgency, p_network: network.trim(),
    });
    setBusy(false);
    if (error) return setProblem(error.message);
    setNote("Saved.");
    onSaved();
  }

  return (
    <Card>
      <CardHeader><CardTitle>Crypto job</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="job-address">Wallet address to send to (your Trust Wallet)</Label>
            <Input id="job-address" value={address} spellCheck={false} autoComplete="off" onChange={(e) => setAddress(e.target.value)} placeholder="0x…" className="font-mono" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="job-network">Network</Label>
              <Input id="job-network" value={network} onChange={(e) => setNetwork(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>How urgent</Label>
              <UrgencySelect value={urgency} onChange={(v) => setUrgency(v as Urgency)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="job-text">What the partner reads</Label>
            <Textarea id="job-text" value={instruction} maxLength={MAX_INSTRUCTION} onChange={(e) => setInstruction(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              You can write <code>{"{agent}"}</code>, <code>{"{balance}"}</code> and <code>{"{provider}"}</code>. {instruction.length}/{MAX_INSTRUCTION}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
            {note ? <span className="text-sm text-muted-foreground">{note}</span> : null}
          </div>
          {problem ? <p role="alert" className="text-sm text-destructive">{problem}</p> : null}
        </form>
      </CardContent>
    </Card>
  );
}

/** One wallet's own name, text, urgency and crypto address (all optional). */
function AgentCard({
  deviceId, phoneName, provider, row, settings, onSaved,
}: { deviceId: string; phoneName: string; provider: JobProvider; row: AgentRow | undefined; settings: JobSettings; onSaved: () => void }) {
  const [form, setForm] = useState<AgentForm>({
    name: row?.agent_name ?? "", instruction: row?.instruction ?? "", urgency: row?.urgency ?? "", wallet: row?.wallet ?? "", network: row?.network ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState("");

  async function save() {
    setNote("");
    const bad = checkAgentForm(form);
    if (bad) return setProblem(bad);
    setProblem("");
    setBusy(true);
    const { error } = await sb.rpc("set_agent_job", {
      p_device: deviceId, p_provider: provider, p_agent_name: form.name.trim(), p_enabled: row?.enabled ?? true,
      p_instruction: form.instruction.trim(), p_urgency: form.urgency, p_wallet: form.wallet.trim(), p_network: form.network.trim(),
    });
    setBusy(false);
    if (error) return setProblem(error.message);
    setNote("Saved.");
    onSaved();
  }

  const id = `${deviceId}-${provider}`;
  return (
    <Card className="grid gap-3 p-4">
      <h4 className="flex flex-wrap items-center gap-2 text-sm font-semibold">{phoneName} <ProviderChip provider={provider} className="font-normal" /></h4>
      <div className="grid gap-1.5">
        <Label htmlFor={`an-${id}`}>Partner's name (shown on the phone)</Label>
        <Input id={`an-${id}`} value={form.name} maxLength={40} placeholder={phoneName} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`ai-${id}`}>Own crypto-job text</Label>
        <Textarea id={`ai-${id}`} value={form.instruction} maxLength={MAX_INSTRUCTION} placeholder={settings.instruction || "Uses the crypto job's text"} onChange={(e) => setForm((f) => ({ ...f, instruction: e.target.value }))} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label>How urgent</Label>
          <UrgencySelect value={form.urgency} withDefault defaultLabel={`Default (${URGENCY_LABEL[settings.urgency]})`} onChange={(v) => setForm((f) => ({ ...f, urgency: v as "" | Urgency }))} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`aw-${id}`}>Own crypto address</Label>
          <Input id={`aw-${id}`} value={form.wallet} spellCheck={false} autoComplete="off" className="font-mono" placeholder={settings.wallets[provider] || "0x…"} onChange={(e) => setForm((f) => ({ ...f, wallet: e.target.value }))} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Button>
        {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
      </div>
      {problem ? <p role="alert" className="text-xs text-destructive">{problem}</p> : null}
    </Card>
  );
}

/** A look at the crypto job on the phone, with sample numbers. */
function Preview({ settings }: { settings: JobSettings }) {
  const first = JOB_PROVIDERS.find((p) => (settings.wallets[p] ?? "") !== "") ?? "bkash";
  const sample = Math.max(settings.threshold, DEFAULT_THRESHOLD) + 2000;
  const text = settings.instruction || "Your instruction appears here.";
  const tone =
    settings.urgency === "critical" ? "border-status-bad/40 bg-status-bad-bg text-status-bad"
      : settings.urgency === "urgent" ? "border-status-warn/40 bg-status-warn-bg text-status-warn"
        : "border-border bg-muted text-foreground";
  return (
    <div className="xl:sticky xl:top-4 xl:self-start">
      <p className="mb-2 text-sm font-medium">How the crypto job looks on the phone</p>
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
        </div>
      </div>
    </div>
  );
}
