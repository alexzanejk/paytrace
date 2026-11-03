import { Badge } from "@/components/ui/badge";
import { ORDER_STATUS, OTHER_STATUS_TONE, PAYMENT_STATUS, type Word } from "@/lib/words";

/** One place decides what a status is called and what colour it is, so every screen agrees.
 *
 *  `kind` says whose status it is: a payment's "review" means "needs a decision", an order's "review" means the same
 *  thing from the order's side, and both are worded for a person, not from the database code. Hover shows the
 *  one-sentence meaning. */
export function StatusBadge({ status, kind = "payment" }: { status: string; kind?: "payment" | "order" | "other" }) {
  const w: Word | undefined = kind === "payment" ? PAYMENT_STATUS[status] : kind === "order" ? ORDER_STATUS[status] : undefined;
  if (w) return <Badge tone={w.tone} title={w.meaning}>{w.label}</Badge>;
  // Anything without plain words yet shows its code, in the right colour, rather than hiding.
  return <Badge tone={OTHER_STATUS_TONE[status] ?? PAYMENT_STATUS[status]?.tone ?? ORDER_STATUS[status]?.tone ?? "idle"}>{status.replace(/_/g, " ")}</Badge>;
}
