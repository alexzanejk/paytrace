import { Badge } from "@/components/ui/badge";

/** One place decides what colour a status is, so every screen agrees. */
const TONE: Record<string, "ok" | "warn" | "info" | "bad" | "idle"> = {
  matched: "ok",
  paid: "ok",
  approved: "ok",
  sent: "ok",
  review: "warn",
  pending: "warn",
  tracked_only: "info",
  unmatched: "idle",
  ignored: "bad",
  cancelled: "bad",
  expired: "bad",
  revoked: "bad",
  failed: "bad",
};

const LABEL: Record<string, string> = {
  tracked_only: "tracked only",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={TONE[status] ?? "idle"}>{LABEL[status] ?? status}</Badge>;
}
