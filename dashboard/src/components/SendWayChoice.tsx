import { useEffect, useState } from "react";
import { sb } from "@/lib/supabase";
import { appWayFor, WAY_LABEL, type SendWay } from "@/lib/sendWay";

/** "Send by: USSD (*247#) / bKash app" (owner 2026-11-10). The app way is offered only for a bKash agent Cash In from a phone
 *  whose app build can do it; otherwise it is shown greyed out with the reason, and the choice stays USSD. */
export function SendWayChoice({ deviceId, provider, account, method, value, onChange }: {
  deviceId: string | null | undefined;
  provider: string | null | undefined;
  account?: string;
  method?: string;
  value: SendWay;
  onChange: (w: SendWay) => void;
}) {
  const [appCashin, setAppCashin] = useState<unknown>(undefined);
  const app = appWayFor({ provider: provider ?? "", account, method, appCashin });
  // Read whether the phone's app can do it; while it cannot yet, read again every 15 s, so a phone updated while this page
  // is open turns the choice on by itself (owner 2026-11-10: "bkash app not selectable" right after updating the Vivo).
  const waiting = provider === "bkash" && account !== "personal" && method !== "send_money" && appCashin !== true;

  useEffect(() => {
    let live = true;
    if (!deviceId) { setAppCashin(undefined); return; }
    const read = () =>
      void sb.from("devices").select("info").eq("id", deviceId).maybeSingle().then(({ data }) => {
        if (live) setAppCashin((data?.info as { app_cashin?: unknown } | null)?.app_cashin);
      });
    read();
    const t = waiting ? window.setInterval(read, 15_000) : undefined;
    return () => { live = false; if (t) window.clearInterval(t); };
  }, [deviceId, waiting]);

  useEffect(() => {
    if (!app.ok && value === "app") onChange("ussd");
  }, [app.ok, value, onChange]);

  return (
    <div className="space-y-1">
      <div className="text-sm font-medium">Send by</div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Send by">
        {(["ussd", "app"] as const).map((w) => {
          const disabled = w === "app" && !app.ok;
          const on = value === w;
          return (
            <button
              key={w}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              title={disabled ? app.why : undefined}
              onClick={() => onChange(w)}
              className={`rounded-lg border px-3 py-1.5 text-sm ${on ? "border-primary bg-primary text-primary-foreground" : "bg-card"} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {WAY_LABEL[w]}
            </button>
          );
        })}
      </div>
      {!app.ok && provider === "bkash" ? <p className="text-xs text-muted-foreground">{app.why}</p> : null}
      {value === "app" ? (
        <p className="text-xs text-muted-foreground">
          The phone opens the bKash app, types the PIN slowly, and does the tap and hold only when the app shows exactly this number and amount.
        </p>
      ) : null}
    </div>
  );
}
