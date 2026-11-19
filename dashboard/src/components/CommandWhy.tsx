import { useEffect, useState } from "react";
import { sb } from "@/lib/supabase";
import { errorText } from "@/lib/phoneCommands";
import { PROVIDER_LABEL } from "@/lib/types";
import { PhoneTrace } from "@/components/PhoneTrace";

/** Why a payout's send stopped, in words: the error in plain language, then the phone's own reason and step log, read
 *  from the command the payout sent (owner 2026-11-19: "let us know the exact reason of failure"). */
export function CommandWhy({ commandId, error, provider }: { commandId: string | null | undefined; error: string | null | undefined; provider: string | null | undefined }) {
  const [screens, setScreens] = useState<string[] | null>(null);
  useEffect(() => {
    if (!commandId) return;
    let alive = true;
    void sb.from("phone_commands").select("screens").eq("id", commandId).maybeSingle()
      .then((r) => { if (alive) setScreens((r.data as { screens?: string[] | null } | null)?.screens ?? null); });
    return () => { alive = false; };
  }, [commandId]);
  if (!error && !screens) return null;
  return (
    <div className="space-y-1">
      {error ? <p className="text-xs text-muted-foreground">{errorText(error, provider ? PROVIDER_LABEL[provider] ?? provider : undefined)}</p> : null}
      <PhoneTrace screens={screens} />
    </div>
  );
}
