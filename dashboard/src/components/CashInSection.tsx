import { useCallback, useEffect, useState } from "react";
import { sb } from "@/lib/supabase";
import { tk } from "@/lib/format";
import { Send } from "lucide-react";
import { Disclosure } from "@/components/Disclosure";
import { CashInCommand } from "@/components/CashInCommand";

/** The one place on the dashboard that moves money: a cash-in this phone makes through the wallet's own menu.
 *
 *  It is folded away, and it says nothing but how to switch it on until the owner has set a daily limit. The limit, the
 *  10,000 cap on one command and the phone's own switch all have to be in place before a single taka can move. */
export function CashInSection({ deviceId }: { deviceId: string }) {
  const [limit, setLimit] = useState<number | null>(null);
  const [usedToday, setUsedToday] = useState<number | null>(null);

  const load = useCallback(async () => {
    const [{ data: rows }, { data: used }] = await Promise.all([
      sb.from("cashin_limits").select("daily_limit").limit(1),
      sb.rpc("cashin_sent_today", { p_device: deviceId }),
    ]);
    const row = (rows ?? [])[0] as { daily_limit: number } | undefined;
    setLimit(row ? Number(row.daily_limit) : 0);
    setUsedToday(used == null ? null : Number(used));
  }, [deviceId]);

  useEffect(() => { void load(); }, [load]);

  const on = (limit ?? 0) > 0;
  const left = on && usedToday != null ? Math.max(0, (limit ?? 0) - usedToday) : null;

  return (
    <Disclosure
      icon={Send}
      title="Cash in from this phone"
      summary={on ? (left == null ? "" : `${tk(left)} left today`) : "switched off"}
    >
      {!on ? (
        <p className="text-sm text-muted-foreground">
          Cash-in is switched off. Set a daily limit on the Jobs page first; until then no cash-in can be asked for from
          any phone. The phone it is asked of must also have its own cash-in switch turned on, in the app.
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {tk(left ?? 0)} of today&apos;s {tk(limit ?? 0)} is left for this phone. One cash-in can be at most {tk(10000)}.
            The phone stops before typing its PIN unless the wallet&apos;s own screen shows the number and the amount.
          </p>
          <div>
            <p className="mb-1 text-sm font-medium">Nagad</p>
            <CashInCommand deviceId={deviceId} provider="nagad" />
          </div>
          <div>
            <p className="mb-1 text-sm font-medium">bKash</p>
            <CashInCommand deviceId={deviceId} provider="bkash" />
          </div>
        </div>
      )}
    </Disclosure>
  );
}
