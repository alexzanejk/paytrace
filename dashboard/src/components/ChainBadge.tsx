import { Badge } from "@/components/ui/badge";
import { tk } from "@/lib/format";

/** Whether the account balance in the message followed on from the previous one.
 *  A forged SMS cannot know the live balance, so "Balance fits" is real reassurance.
 *  "Not confirmed" is a flag to look at, not proof of anything: the balance also moves
 *  through cash-in and send money, which PayTrace never sees. */
export function ChainBadge({ status, delta }: { status: string | null; delta: number | null }) {
  if (status === "ok") {
    return <Badge tone="ok" title={delta == null ? undefined : `Balance rose by ${tk(delta)}`}>Balance fits</Badge>;
  }
  if (status === "mismatch") {
    return (
      <Badge tone="warn" title={delta == null ? undefined : `Balance changed by ${tk(delta)}`}>
        Not confirmed
      </Badge>
    );
  }
  return <Badge tone="idle">No check</Badge>;
}
