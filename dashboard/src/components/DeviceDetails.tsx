import { BatteryMedium, TriangleAlert } from "lucide-react";
import { infoProblems, type DeviceInfo } from "@/lib/deviceHealth";

/** What the phone reported about itself: battery, app version, and anything stopping it capturing payments. */
export function DeviceDetails({ info }: { info: DeviceInfo | null | undefined }) {
  if (!info || !info.reported_at) return <span className="text-xs text-muted-foreground">No report yet</span>;
  const problems = infoProblems(info);
  return (
    <div className="flex max-w-xs flex-col gap-1 whitespace-normal text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
        {info.battery !== undefined ? (
          <span className="inline-flex items-center gap-1">
            <BatteryMedium className="h-3.5 w-3.5" aria-hidden />
            {info.battery}%
          </span>
        ) : null}
        {info.pending ? <span>{info.pending} waiting to send</span> : null}
        {info.app_version ? <span>v{info.app_version}</span> : null}
      </div>
      {problems.map((p) => (
        <span key={p} className="inline-flex items-start gap-1 text-status-bad">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {p}
        </span>
      ))}
    </div>
  );
}
