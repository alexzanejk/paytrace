import { useMemo, useState } from "react";
import { Percent } from "lucide-react";
import { sb } from "@/lib/supabase";
import { dhakaDay } from "@/lib/period";
import { tk } from "@/lib/format";
import { PROVIDERS, PROVIDER_LABEL, type Device } from "@/lib/types";
import { RATE_KINDS, KIND_LABEL, changedRates, fmtPct, owedOf, ratesOn, rateKey, type CommissionBalance, type RateRow } from "@/lib/commission";
import { Disclosure } from "@/components/Disclosure";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

/** One phone's partner commission: the % per provider and kind, whether its own app shows the earnings, and what is owed. */
export function CommissionCard({
  device,
  rates,
  balance,
  onChanged,
  open,
}: {
  open?: boolean;
  device: Device;
  rates: RateRow[];
  balance: CommissionBalance | undefined;
  onChanged: () => void;
}) {
  const today = dhakaDay();
  const current = useMemo(() => ratesOn(rates, device.id, today), [rates, device.id, today]);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [from, setFrom] = useState(today);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState("");
  const { owed, over } = owedOf(balance?.earned ?? 0, balance?.paid ?? 0);

  async function toggleVisible(on: boolean) {
    setProblem("");
    const { error } = await sb.rpc("set_device_earnings_visible", { p_device: device.id, p_show: on });
    if (error) return setProblem(error.message);
    onChanged();
  }

  async function save() {
    setNote("");
    setProblem("");
    const { changes, invalid } = changedRates(current, typed);
    if (invalid.length > 0) return setProblem("A rate must be a number from 0 to 100, such as 4 or 4.5.");
    if (changes.length === 0) return setNote("Nothing changed.");
    setBusy(true);
    const { error } = await sb.rpc("set_commission_rates", { p_device: device.id, p_from: from, p_rates: changes });
    setBusy(false);
    if (error) return setProblem(error.message);
    setTyped({});
    setNote(`Saved ${changes.length} rate${changes.length === 1 ? "" : "s"}, from ${from}.`);
    onChanged();
  }

  return (
    <Disclosure
      open={open}
      icon={Percent}
      title="Partner commission"
      summary={owed > 0 || over > 0 ? `${over > 0 ? "Overpaid" : "Owed"} ${tk(over > 0 ? over : owed)}` : current.size === 0 ? "No rates yet" : "Nothing owed"}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          Show earnings in this phone's app
          <Switch checked={!!device.show_earnings} aria-label={`Show earnings in the app on ${device.name}`} onCheckedChange={(on) => void toggleVisible(on)} />
        </span>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        The partner earns this % of each day's agent Cash Out total (12:00 AM to 11:59 PM Bangladesh time) through this phone. Money received on a
        personal account earns nothing. Only payments counted in your totals earn commission; held ones earn it once you approve them. Leave a box
        empty to keep its rate, type 0 for none.
      </p>

      <div className="grid gap-3">
        {RATE_KINDS.map((kind) => (
          <div key={kind}>
            <p className="mb-1 text-xs font-medium">{KIND_LABEL[kind]}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {PROVIDERS.map((p) => {
                const key = rateKey(p, kind);
                const now = current.get(key);
                return (
                  <label key={key} className="grid gap-1 text-xs text-muted-foreground">
                    {PROVIDER_LABEL[p]}
                    <span className="flex items-center gap-1.5">
                      <Input
                        inputMode="decimal"
                        className="h-9"
                        value={typed[key] ?? ""}
                        onChange={(e) => setTyped((t) => ({ ...t, [key]: e.target.value }))}
                        placeholder={now === undefined ? "none" : String(now)}
                        aria-label={`${PROVIDER_LABEL[p]} ${KIND_LABEL[kind]} percent for ${device.name}`}
                      />
                      <span aria-hidden>%</span>
                    </span>
                    <span className="text-[11px]">{now === undefined ? "No rate yet" : `Now ${fmtPct(now)}`}</span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs text-muted-foreground">
          New rates apply from
          <Input type="date" className="h-9 w-40" value={from} max={today} onChange={(e) => setFrom(e.target.value || today)} aria-label="Rates apply from this day" />
        </label>
        <Button size="sm" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : "Save rates"}
        </Button>
        <span className="text-xs text-muted-foreground">Earlier days keep the rate they had.</span>
      </div>
      {note ? <p className="mt-2 text-xs text-muted-foreground">{note}</p> : null}
      {problem ? <p className="mt-2 text-xs text-destructive">{problem}</p> : null}

      <CommissionNumber device={device} onChanged={onChanged} />

      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-sm">
        <span>Earned: <b className="tabular">{tk(balance?.earned ?? 0)}</b></span>
        <span>Paid: <b className="tabular">{tk(balance?.paid ?? 0)}</b></span>
        <span>{over > 0 ? "Overpaid by" : "Still owed"}: <b className="tabular">{tk(over > 0 ? over : owed)}</b></span>
        <a className="text-xs underline" href="#/commission">Open the Commission page</a>
      </p>
    </Disclosure>
  );
}

/** Where this partner's commission is paid. Saved only here, by the owner (never from the partner's app), typed twice. */
function CommissionNumber({ device, onChanged }: { device: Device; onChanged: () => void }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const digits = (s: string) => s.replace(/\D/g, "").replace(/^880/, "0");
  const same = a.trim() !== "" && digits(a) === digits(b);
  async function save(value: string | null) {
    setProblem("");
    setBusy(true);
    const { error } = await sb.rpc("set_commission_number", { p_device: device.id, p_number: value });
    setBusy(false);
    if (error) return setProblem(error.message);
    setA(""); setB("");
    onChanged();
  }
  return (
    <div className="mt-3 grid gap-2 border-t border-border pt-3 text-sm">
      <p className="text-xs font-medium">Commission is paid to</p>
      <p>{device.commission_number ? <span className="font-mono text-base">{device.commission_number}</span> : <span className="text-status-warn">No number saved yet. Daily payouts need it.</span>}</p>
      <div className="flex flex-wrap items-end gap-2">
        <Input className="h-9 w-44" inputMode="tel" placeholder="01XXXXXXXXX" value={a} onChange={(e) => setA(e.target.value)} aria-label="Commission number" />
        <Input className="h-9 w-44" inputMode="tel" placeholder="Type it again" value={b} onPaste={(e) => e.preventDefault()} onChange={(e) => setB(e.target.value)} aria-label="Commission number again" />
        <Button size="sm" disabled={!same || busy} onClick={() => void save(a)}>{device.commission_number ? "Change number" : "Save number"}</Button>
        {device.commission_number ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save(null)}>Remove</Button> : null}
      </div>
      {a && b && !same ? <p className="text-xs text-status-warn">The two numbers are not the same.</p> : null}
      {problem ? <p className="text-xs text-destructive">{problem}</p> : null}
    </div>
  );
}
