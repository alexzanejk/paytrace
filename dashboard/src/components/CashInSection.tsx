import { useCallback, useEffect, useState } from "react";
import { sb } from "@/lib/supabase";
import { tk } from "@/lib/format";
import { Send } from "lucide-react";
import { Disclosure } from "@/components/Disclosure";
import { CashInCommand } from "@/components/CashInCommand";
import { WALLETS, walletLabel } from "@/lib/phoneCommands";

/** A cash-in this phone makes through the wallet's own menu, to one of your saved cash-in numbers.
 *
 *  Since migration 065 (owner 2026-11-08) an agent Cash In has no daily limit: what guards it is the phone's own
 *  "Send money from this phone" switch, the 100 to 50,000 Tk bounds on one cash-in (database and phone), the saved-number
 *  rule, and the phone typing its PIN only on a wallet screen showing this number and this amount. To pay on received
 *  money to a typed number, use the Payout page. */
export function CashInSection({ deviceId, open }: { deviceId: string; open?: boolean }) {
  const [usedToday, setUsedToday] = useState<number | null>(null);

  const load = useCallback(async () => {
    const { data: used } = await sb.rpc("cashin_sent_today", { p_device: deviceId });
    setUsedToday(used == null ? null : Number(used));
  }, [deviceId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <Disclosure open={open} icon={Send} title="Cash in from this phone" summary={usedToday ? `${tk(usedToday)} sent today` : ""}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {usedToday != null ? `${tk(usedToday)} sent by cash-in from this phone today. ` : ""}No daily limit for an agent
          Cash In; one cash-in is {tk(100)} to {tk(50000)}. The phone stops before typing its PIN unless the wallet&apos;s own
          screen shows the number and the amount. To pay on received money to a number you type, use the Payout page.
        </p>
        {WALLETS.map((w) => (
          <div key={w}>
            <p className="mb-1 text-sm font-medium">{walletLabel(w)}</p>
            <CashInCommand deviceId={deviceId} provider={w} />
            {w === "rocket" ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Rocket asks for the PIN on a bare screen, so unlike the other two the wallet never repeats the number
                and the amount back. PayTrace still types both into Rocket&apos;s own boxes first and stops if that
                screen shows any other number or amount, but it cannot be checked the way bKash and Nagad are.
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </Disclosure>
  );
}
