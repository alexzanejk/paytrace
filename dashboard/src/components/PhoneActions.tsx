import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Inbox, ListChecks, ReceiptText, RotateCw, Send, Sun } from "lucide-react";
import { sb } from "@/lib/supabase";
import { when } from "@/lib/format";
import { actionLine, isLive, PHONE_ACTIONS, PHONE_ACTION_KINDS, POLL_MS, type PhoneActionKind, type PhoneCommand } from "@/lib/phoneCommands";
import { nudgePhone } from "@/lib/wake";
import { Button } from "@/components/ui/button";
import { PhoneTrace } from "@/components/PhoneTrace";

const ICON: Record<PhoneActionKind, typeof RotateCw> = { restart: RotateCw, inbox: Inbox, resend: Send, screen: Sun, ring: Bell, apprecord: ListChecks, appread: ReceiptText, nagadrecord: ListChecks, nagadread: ReceiptText };
const APP_KINDS = new Set<string>(["appread", "apprecord", "nagadread", "nagadrecord"]);

/** Phone controls (owner request 2026-11-02): restart PayTrace, read the inbox now, send what is waiting, wake the
 *  screen, ring. None touches a wallet. They queue like a balance check and the phone takes them on its next beat,
 *  which the wake-up push usually brings forward to a second or two.
 *
 *  Only the newest control is shown, whichever it was: five lines of history under five buttons would bury the one
 *  that matters, which is what the phone is doing right now. */
export function PhoneActions({ deviceId }: { deviceId: string }) {
  const [last, setLast] = useState<PhoneCommand | null>(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState<PhoneActionKind | null>(null);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    const { data } = await sb
      .from("phone_commands")
      .select("id,kind,provider,status,balance,error,created_at,finished_at,screens")
      .eq("device_id", deviceId)
      .in("kind", PHONE_ACTION_KINDS)
      .order("created_at", { ascending: false })
      .limit(1);
    setLast(((data ?? [])[0] as PhoneCommand | undefined) ?? null);
  }, [deviceId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!isLive(last)) return;
    timer.current = window.setTimeout(() => void load(), POLL_MS);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [last, load]);

  async function ask(kind: PhoneActionKind) {
    setProblem("");
    setBusy(kind);
    const { error } = await sb.rpc("queue_phone_action", { p_device: deviceId, p_kind: kind });
    setBusy(null);
    if (error) return setProblem(error.message);
    // Wake the phone so it takes this now rather than on its next 30-second beat. It is queued either way.
    nudgePhone(deviceId);
    await load();
  }

  const live = isLive(last);
  const line = actionLine(last, when as (t: string) => string);
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        {PHONE_ACTIONS.map((a) => {
          const Icon = ICON[a.kind];
          return (
            <Button
              key={a.kind}
              size="sm"
              variant="outline"
              title={a.help}
              onClick={() => void ask(a.kind)}
              disabled={busy !== null || live}
            >
              <Icon aria-hidden /> {a.label}
            </Button>
          );
        })}
      </div>
      {line ? <p role="status" className="text-sm text-muted-foreground">{line}</p> : null}
      {last && APP_KINDS.has(last.kind) && !live ? (
        <PhoneTrace screens={last.screens} label={last.status === "done" ? "How the phone did it (login and scrolling)" : undefined} />
      ) : null}
      {problem ? <p className="text-xs text-destructive">{problem}</p> : null}
    </div>
  );
}
