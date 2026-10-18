import { must, sb } from "@/lib/supabase";
import type { Device } from "@/lib/types";
import { useQuery } from "@/hooks/useQuery";

export type DeviceRow = Device;

/** Every phone that ever connected (removed ones too, so old transactions still show a name). */
export function useDevices(refreshMs = 15000) {
  const q = useQuery(
    async () => must(await sb.from("devices").select("*").neq("status", "pending").order("created_at", { ascending: true })) as Device[],
    [],
    { refreshMs },
  );
  const list = q.data ?? [];
  const byId = new Map(list.map((d) => [d.id, d]));
  const nameOf = (id: string | null | undefined) => {
    if (!id) return "Unknown phone";
    const d = byId.get(id);
    if (!d) return "Unknown phone";
    return (d.name || d.pair_code) + (d.status === "revoked" ? " (removed)" : "");
  };
  return { ...q, list, byId, nameOf };
}
