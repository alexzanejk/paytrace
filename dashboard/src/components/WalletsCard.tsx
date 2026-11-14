import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Wallet } from "lucide-react";
import { sb } from "@/lib/supabase";
import { PROVIDERS, PROVIDER_LABEL, type DeviceWallet, type WalletGroup } from "@/lib/types";
import { normalizeBdNumber, walletSuggestions, type ReportedWallet, statFor, walletStatLine, type WalletOrderStat } from "@/lib/walletNumbers";
import { Disclosure } from "@/components/Disclosure";
import { GROUP_CODE, GroupChoice } from "@/components/GroupChoice";
import { ProviderChip } from "@/components/ProviderChip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

/** Same rule as the database: the partner's link code, 3 lowercase letters and 4 digits (like dvw9166). */
export const GROUP_PATTERN = GROUP_CODE;

const METHOD_LABEL = { send_money: "Send Money", cash_out: "Cash Out (agent)" } as const;

/** The wallet numbers this phone receives deposits on. The pay page shows one of these to a customer. [reported] are the
 *  numbers the phone app itself has saved (its heartbeat carries them), offered here so they are picked, not typed. */
export function WalletsCard({ deviceId, wallets, reported, stats, defaultGroup, onChanged, open }: { open?: boolean; deviceId: string; wallets: DeviceWallet[]; reported?: ReportedWallet[]; stats?: WalletOrderStat[]; defaultGroup: string; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [provider, setProvider] = useState<string>("bkash");
  const [number, setNumber] = useState("");
  const [method, setMethod] = useState<"send_money" | "cash_out">("send_money");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [groups, setGroups] = useState<WalletGroup[]>([{ name: "main", enabled: true }]);
  const [newGroup, setNewGroup] = useState("");
  const [phoneGroup, setPhoneGroup] = useState(defaultGroup);
  const suggestions = walletSuggestions(reported, wallets);
  const fromPhone = new Map(suggestions.map((x) => [x.provider, x]));
  const notYet = suggestions.filter((x) => x.state === "missing");
  const typed = normalizeBdNumber(number);

  const loadGroups = useCallback(async () => {
    const { data } = await sb.from("wallet_groups").select("name,enabled").order("name");
    if (data) setGroups((data as WalletGroup[]).sort((a, b) => (a.name === "main" ? -1 : b.name === "main" ? 1 : a.name.localeCompare(b.name))));
  }, []);
  useEffect(() => { void loadGroups(); }, [loadGroups]);

  async function addGroup(e: FormEvent) {
    e.preventDefault();
    const { error } = await sb.rpc("add_wallet_group", { p_name: newGroup });
    if (error) return setProblem(error.message);
    setProblem("");
    setNewGroup("");
    await loadGroups();
  }

  async function applyPhoneGroup() {
    const { error } = await sb.rpc("set_device_group", { p_device_id: deviceId, p_group: phoneGroup, p_move_numbers: true });
    if (error) return setProblem(error.message);
    setProblem("");
    await loadGroups();
    onChanged();
  }

  async function setGroup(walletId: string, group: string) {
    const { error } = await sb.rpc("set_wallet_group", { p_wallet_id: walletId, p_group: group });
    if (error) return setProblem(error.message);
    setProblem("");
    onChanged();
  }

  async function save(p: string, n: string, m: string, enabled: boolean): Promise<boolean> {
    const { error } = await sb.rpc("set_device_wallet", { p_device_id: deviceId, p_provider: p, p_number: n, p_method: m, p_enabled: enabled });
    if (error) {
      setProblem(error.message);
      return false;
    }
    setProblem("");
    onChanged();
    return true;
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    if (await save(provider, number, method, true)) {
      setNumber("");
      setAdding(false);
    }
    setBusy(false);
  }

  return (
    <Disclosure
      open={open}
      icon={Wallet}
      title="Deposit numbers"
      summary={wallets.length === 0 ? "None yet" : `${wallets.length} number${wallets.length === 1 ? "" : "s"}`}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>This phone's group</span>
        <GroupChoice groups={groups.map((g) => g.name)} value={phoneGroup} onChange={setPhoneGroup} label="This phone's group" />
        <Button size="sm" variant="outline" onClick={() => void applyPhoneGroup()} disabled={phoneGroup === defaultGroup || (phoneGroup !== "main" && !GROUP_CODE.test(phoneGroup))}>
          Apply to all its numbers
        </Button>
      </div>
      <div className="mb-2 flex justify-end">
        <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
          {adding ? "Close" : "Add a number"}
        </Button>
      </div>
      {wallets.length === 0 && !adding ? (
        <p className="text-xs text-muted-foreground">
          No number yet, so customers are never sent to this phone. Add the wallet number this phone receives money on.
        </p>
      ) : null}
      {notYet.length > 0 ? (
        <div className="mb-3 rounded-md border border-dashed p-2">
          <p className="mb-1 text-xs text-muted-foreground">Saved in the phone app, not a deposit number yet. One tap adds it; say how the customer pays.</p>
          <ul className="grid gap-1">
            {notYet.map((x) => (
              <li key={x.provider} className="flex flex-wrap items-center gap-2 text-sm">
                <ProviderChip provider={x.provider} />
                <span className="font-mono tabular">{x.number}</span>
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => void save(x.provider, x.number, "cash_out", true)}>
                  Add as Cash Out (agent)
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => void save(x.provider, x.number, "send_money", true)}>
                  Add as Send Money
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <ul className="grid gap-2">
        {wallets.map((w) => (
          <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <ProviderChip provider={w.provider} />
              <span className="font-mono tabular">{w.wallet_number}</span>
              <Badge tone="idle">{METHOD_LABEL[w.method]}</Badge>
              {!normalizeBdNumber(w.wallet_number) ? (
                <span className="text-xs text-destructive">Not a valid number ({w.wallet_number.length} digits): customers cannot pay to it. Add the right one below.</span>
              ) : fromPhone.get(w.provider)?.state === "matches" ? (
                <span className="text-xs text-emerald-700 dark:text-emerald-400">matches the phone ✓</span>
              ) : fromPhone.get(w.provider)?.state === "differs" ? (
                <span className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                  the phone says {fromPhone.get(w.provider)!.number}
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void save(w.provider, fromPhone.get(w.provider)!.number, w.method, w.enabled)}>
                    Use the phone's number
                  </Button>
                </span>
              ) : null}
              {(() => {
                const line = walletStatLine(statFor(stats, w));
                return line ? <span className={`basis-full text-xs ${line.tone === "warn" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>{line.text}</span> : null;
              })()}
            </span>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Select value={w.wallet_group ?? "main"} onValueChange={(g) => void setGroup(w.id, g)}>
                <SelectTrigger aria-label={`Group for ${w.wallet_number}`} className="h-8 w-[7.5rem] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.name} value={g.name}>{g.name === "main" ? "Main" : g.name}{g.enabled ? "" : " (off)"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {w.enabled ? "On" : "Off"}
              <Switch
                checked={w.enabled}
                aria-label={`${PROVIDER_LABEL[w.provider] ?? w.provider} deposits on this phone`}
                onCheckedChange={(on) => void save(w.provider, w.wallet_number, w.method, on)}
              />
            </span>
          </li>
        ))}
      </ul>
      {adding ? (
        <form onSubmit={add} className="mt-3 grid gap-2 sm:grid-cols-2">
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger aria-label="Provider"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PROVIDERS.map((p) => (
                <SelectItem key={p} value={p}>{PROVIDER_LABEL[p]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={method} onValueChange={(v) => setMethod(v as "send_money" | "cash_out")}>
            <SelectTrigger aria-label="How the customer pays"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="send_money">Customer sends money</SelectItem>
              <SelectItem value="cash_out">Customer cashes out at this agent</SelectItem>
            </SelectContent>
          </Select>
          <Input inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Wallet number, 11 digits, e.g. 01712345678" aria-label="Wallet number" className="sm:col-span-2" />
          {number.trim() && !typed ? (
            <p className="text-xs text-destructive sm:col-span-2">A Bangladesh number has 11 digits and starts with 01 (you typed {number.replace(/\D/g, "").length}).</p>
          ) : null}
          <Button type="submit" disabled={busy || !typed} className="sm:col-span-2">
            {busy ? "Saving…" : "Save number"}
          </Button>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Cash Out means the customer cashes out at this agent number; the phone's Cash Out receipt then pays the order. If the balance
            check on that receipt fails, the order is held for you to approve instead of being credited. Adding the same provider again
            replaces its number.
          </p>
        </form>
      ) : null}
      <form onSubmit={addGroup} className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          value={newGroup}
          onChange={(e) => setNewGroup(e.target.value.toLowerCase())}
          placeholder="Partner code, e.g. dvw9166"
          aria-label="New group name"
          maxLength={7}
          className="h-8 w-48 text-xs"
        />
        <Button type="submit" size="sm" variant="outline" disabled={!GROUP_PATTERN.test(newGroup.trim())}>Add group</Button>
        <span className="text-xs text-muted-foreground">Groups let a website use numbers from certain phones only. Customers fall back to Main when a group has no online number.</span>
      </form>
      {problem ? <p className="mt-2 text-xs text-destructive">{problem}</p> : null}
    </Disclosure>
  );
}
