import { useState, type FormEvent } from "react";
import { Wallet } from "lucide-react";
import { sb } from "@/lib/supabase";
import { PROVIDERS, PROVIDER_LABEL, type DeviceWallet } from "@/lib/types";
import { Disclosure } from "@/components/Disclosure";
import { ProviderChip } from "@/components/ProviderChip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const METHOD_LABEL = { send_money: "Send Money", cash_out: "Cash Out (agent)" } as const;

/** The wallet numbers this phone receives deposits on. The pay page shows one of these to a customer. */
export function WalletsCard({ deviceId, wallets, onChanged }: { deviceId: string; wallets: DeviceWallet[]; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [provider, setProvider] = useState<string>("bkash");
  const [number, setNumber] = useState("");
  const [method, setMethod] = useState<"send_money" | "cash_out">("send_money");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);

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
      icon={Wallet}
      title="Deposit numbers"
      summary={wallets.length === 0 ? "None yet" : `${wallets.length} number${wallets.length === 1 ? "" : "s"}`}
    >
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
      <ul className="grid gap-2">
        {wallets.map((w) => (
          <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <ProviderChip provider={w.provider} />
              <span className="font-mono tabular">{w.wallet_number}</span>
              <Badge tone="idle">{METHOD_LABEL[w.method]}</Badge>
            </span>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
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
          <Input inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Wallet number, e.g. 01712345678" aria-label="Wallet number" className="sm:col-span-2" />
          <Button type="submit" disabled={busy || number.replace(/\D/g, "").length < 10} className="sm:col-span-2">
            {busy ? "Saving…" : "Save number"}
          </Button>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Cash Out means the customer cashes out at this agent number; the phone's Cash Out receipt then pays the order. If the balance
            check on that receipt fails, the order is held for you to approve instead of being credited. Adding the same provider again
            replaces its number.
          </p>
        </form>
      ) : null}
      {problem ? <p className="mt-2 text-xs text-destructive">{problem}</p> : null}
    </Disclosure>
  );
}
