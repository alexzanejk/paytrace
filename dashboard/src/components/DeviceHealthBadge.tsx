import { Badge } from "@/components/ui/badge";
import { agoText, deviceHealth, type HealthInput } from "@/lib/deviceHealth";
import { useNow } from "@/hooks/useNow";

const LABEL = { online: "Online", offline: "Offline" } as const;
const TONE = { online: "ok", offline: "bad" } as const;

/** Online / Offline, with how long ago the phone last spoke. */
export function DeviceHealthBadge({ device }: { device: HealthInput }) {
  const h = deviceHealth(device, useNow(5000));
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge tone={TONE[h.level]}>{LABEL[h.level]}</Badge>
      <span className="text-xs text-muted-foreground">
        {h.neverSpoke ? `waiting for first check-in (approved ${agoText(h.minutes)})` : agoText(h.minutes)}
      </span>
    </div>
  );
}
