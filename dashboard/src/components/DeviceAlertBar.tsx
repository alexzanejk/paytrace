import { TriangleAlert } from "lucide-react";
import { must, sb } from "@/lib/supabase";
import type { Device } from "@/lib/types";
import { agoText, blockingProblems, deviceHealth } from "@/lib/deviceHealth";
import { useQuery } from "@/hooks/useQuery";
import { useNow } from "@/hooks/useNow";

/** A red strip on every page when a phone is offline or cannot capture payments.
 *  An offline phone means payments may be missing, so this is not something to find by chance. */
export function DeviceAlertBar({ onOpen }: { onOpen: () => void }) {
  const { data } = useQuery(
    async () =>
      must(
        await sb.from("devices").select("id,name,pair_code,status,last_seen_at,approved_at,info").eq("status", "approved"),
      ) as Pick<Device, "id" | "name" | "pair_code" | "status" | "last_seen_at" | "approved_at" | "info">[],
    [],
    { refreshMs: 15000 },
  );
  const now = useNow(5000);

  const lines: string[] = [];
  for (const d of data ?? []) {
    const name = d.name || d.pair_code;
    const h = deviceHealth(d, now);
    if (h.level === "offline") lines.push(`${name} is offline (last heard ${agoText(h.minutes)}). Payments sent to it may be missing.`);
    // Failed sends and a missing "read old SMS" permission are shown on the Devices page. The strip is only for
    // things that stop payments being captured right now.
    for (const p of blockingProblems(d.info)) lines.push(`${name}: ${p}.`);
  }
  if (lines.length === 0) return null;

  return (
    <div role="alert" className="border-b border-border bg-status-bad-bg text-status-bad">
      <div className="mx-auto flex max-w-7xl items-start gap-2 px-4 py-2.5 text-sm">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="flex-1">
          {lines.map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
        <button type="button" onClick={onOpen} className="shrink-0 font-medium underline underline-offset-2">
          Open Devices
        </button>
      </div>
    </div>
  );
}
