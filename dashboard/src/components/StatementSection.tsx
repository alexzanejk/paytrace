import { FileClock } from "lucide-react";
import { Disclosure } from "@/components/Disclosure";
import { StatementCheck } from "@/components/StatementCheck";

/** The wallet's own statement, for when a phone's balance does not match what PayTrace has stored.
 *
 *  It only reads. The wallet's list is the truth about what happened on that account, so any Cash Out on it that
 *  PayTrace has no payment for is an SMS that never arrived — which is the thing that cannot be found any other way. */
export function StatementSection({ deviceId }: { deviceId: string }) {
  return (
    <Disclosure icon={FileClock} title="Check against the wallet's own statement" summary="when the balance does not match">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          The phone walks the wallet&apos;s own menu and brings back its list of recent transactions. Anything the
          wallet lists as a Cash Out that PayTrace has no payment for is an SMS that never arrived. Nothing is sent and
          nothing is changed. It takes about a minute, and the phone must be online with its balance-check switch on.
        </p>
        <div>
          <p className="mb-1 text-sm font-medium">bKash</p>
          <StatementCheck deviceId={deviceId} provider="bkash" />
        </div>
        <div>
          <p className="mb-1 text-sm font-medium">Nagad</p>
          <StatementCheck deviceId={deviceId} provider="nagad" />
          <p className="mt-1 text-xs text-muted-foreground">
            Nagad&apos;s statement screens have never been seen, so this may come back saying the menu looked different.
            Whatever it does show is kept word for word, which is how we learn what it looks like.
          </p>
        </div>
      </div>
    </Disclosure>
  );
}
