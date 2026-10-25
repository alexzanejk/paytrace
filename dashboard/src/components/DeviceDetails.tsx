import { BatteryMedium, LifeBuoy, TriangleAlert } from "lucide-react";
import { agoText, infoProblems, minutesSince, type DeviceInfo } from "@/lib/deviceHealth";

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
        <span title="The server can send this phone a wake-up message if it goes quiet">
          Wake-up messages: {info.push_ready ? "ready" : "not set up"}
        </span>
        {info.wake_count ? (
          <span title="Wake-up messages that reached this phone">
            {info.wake_count} received{info.last_wake_at ? `, last ${agoText(minutesSince(info.last_wake_at))}` : ""}
          </span>
        ) : info.push_ready ? (
          <span>none received yet</span>
        ) : null}
        {info.default_sms ? <span title="PayTrace is this phone's messaging app, which phone brands rarely stop">SMS app mode</span> : null}
        {info.keepalive_test === "pass" ? (
          <span className="text-status-ok" title="The owner locked the phone for 10 minutes and PayTrace never went quiet">
            Screen-off test passed{info.keepalive_test_at ? `, ${agoText(minutesSince(info.keepalive_test_at))}` : ""}
          </span>
        ) : info.keepalive_test === "short" ? (
          <span title="The test could not tell: the screen was not off for long enough">Screen-off test: not conclusive</span>
        ) : info.keepalive_test === "fail" ? null : (
          <span title="Ask the partner to run the screen-off test in the app (Settings, then Keep this phone running)">Screen-off test: not done</span>
        )}
      </div>
      {info.recovered ? (
        <span className="inline-flex items-start gap-1 text-status-ok">
          <LifeBuoy className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {info.recovered} missed message{info.recovered === 1 ? "" : "s"} recovered
        </span>
      ) : null}
      {problems.map((p) => (
        <span key={p} className="inline-flex items-start gap-1 text-status-bad">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {p}
        </span>
      ))}
    </div>
  );
}
