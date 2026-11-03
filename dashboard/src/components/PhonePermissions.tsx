import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { sb } from "@/lib/supabase";
import type { Device } from "@/lib/types";
import { Switch } from "@/components/ui/switch";

/** What the dashboard may ask this phone to do (owner 2026-11-03: these switches belong here, not on the phone, so nobody
 *  changes them by mistake). The phone follows what it is told on its next 30-second check; what it reports back is shown
 *  beside each switch so the owner can see that it has really taken it. Sending money also needs a daily limit above zero
 *  (Jobs page); that and every rule on the phone itself still apply. */
export function PhonePermissions({ device, onChanged }: { device: Device; onChanged: () => void }) {
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const balance = device.allow_balance !== false;
  const cashin = device.allow_cashin === true;
  const info = device.info;

  async function save(next: { balance?: boolean; cashin?: boolean }) {
    setProblem("");
    setBusy(true);
    const { error } = await sb.rpc("set_device_permissions", {
      p_device: device.id,
      p_balance: next.balance ?? balance,
      p_cashin: next.cashin ?? cashin,
    });
    setBusy(false);
    if (error) return setProblem(error.message);
    onChanged();
  }

  // The phone's own report: "taken" once it says the same as the switch, "waiting" until then. Older app builds report nothing.
  const state = (want: boolean, got: boolean | undefined) =>
    got === undefined ? "" : got === want ? "The phone has it." : "Waiting for the phone (up to 30 seconds).";

  return (
    <div className="rounded-lg border border-border p-3">
      <p className="mb-2 flex items-center gap-2 text-sm font-medium">
        <ShieldCheck className="h-4 w-4" aria-hidden /> What the dashboard may do with this phone
      </p>
      <div className="flex flex-col gap-3">
        <label className="flex items-start justify-between gap-3">
          <span className="min-w-0 text-sm">
            Check the balance and read the statement
            <span className="block text-xs text-muted-foreground">
              Only reads. Off means this phone refuses the dashboard's balance checks. {state(balance, info?.ussd_allowed)}
            </span>
          </span>
          <Switch checked={balance} disabled={busy} aria-label={`Let the dashboard check the balance on ${device.name}`} onCheckedChange={(on) => void save({ balance: on })} />
        </label>
        <label className="flex items-start justify-between gap-3">
          <span className="min-w-0 text-sm">
            Send money from this phone
            <span className="block text-xs text-muted-foreground">
              Off means this phone never cashes in, whatever is asked. It also needs a daily limit above zero on the Jobs page. {state(cashin, info?.cashin_allowed)}
            </span>
          </span>
          <Switch checked={cashin} disabled={busy} aria-label={`Let the dashboard send money from ${device.name}`} onCheckedChange={(on) => void save({ cashin: on })} />
        </label>
      </div>
      {problem ? <p className="mt-2 text-xs text-destructive">{problem}</p> : null}
    </div>
  );
}
