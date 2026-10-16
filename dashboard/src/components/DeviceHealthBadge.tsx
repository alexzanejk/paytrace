import { Badge } from "@/components/ui/badge";
import { agoText, deviceHealth, type HealthInput } from "@/lib/deviceHealth";

const LABEL = { online: "Online", late: "Late", silent: "Silent" } as const;
const TONE = { online: "ok", late: "warn", silent: "bad" } as const;

/** Online / Late / Silent, with how long ago the phone last spoke. */
export function DeviceHealthBadge({ device }: { device: HealthInput }) {
  const h = deviceHealth(device);
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge tone={TONE[h.level]}>{LABEL[h.level]}</Badge>
      <span className="text-xs text-muted-foreground">
        {h.neverSpoke ? `waiting for first check-in (approved ${agoText(h.minutes)})` : agoText(h.minutes)}
      </span>
    </div>
  );
}
