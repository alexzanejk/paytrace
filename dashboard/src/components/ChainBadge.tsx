import { Badge } from "@/components/ui/badge";
import { tk } from "@/lib/format";
import { genuineWord } from "@/lib/words";

/** "Looks genuine?" — whether the balance printed in this SMS followed on from the previous one.
 *  A forged SMS cannot know the live balance, so "Yes" is real reassurance. "Can't tell" is a flag to look at, not
 *  proof of anything: the balance also moves through cash-in and send money, which PayTrace never sees. The words
 *  live in lib/words.ts; the balance change is added to the tooltip when it is known. */
export function ChainBadge({ status, delta }: { status: string | null; delta: number | null }) {
  const w = genuineWord(status);
  const change = delta == null ? "" : ` Balance changed by ${tk(delta)}.`;
  return <Badge tone={w.tone} title={w.meaning + change}>{w.label}</Badge>;
}
