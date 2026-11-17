import { useCallback, useEffect, useRef, useState } from "react";
import { Wallet } from "lucide-react";
import { sb } from "@/lib/supabase";
import { tk, when } from "@/lib/format";
import { errorText, isLive, POLL_MS, type PhoneCommand } from "@/lib/phoneCommands";
import { PERSONAL_BALANCE_KIND, readPersonalBalances } from "@/lib/personalBalance";
import { nudgePhone } from "@/lib/wake";
import { personalAccounts, type WalletAccount } from "@/lib/payouts";
import { Button } from "@/components/ui/button";
import { PhoneTrace } from "@/components/PhoneTrace";

/** The balance of this phone's PERSONAL bKash accounts, read through *247# → My bKash → Check Balance (owner's recording
 *  2026-11-17). The phone checks each personal account saved in its app, on that account's own SIM with its own PIN, and
 *  answers one line per account. Only reads. */
export function PersonalBalanceCheck({ deviceId, personalOn, wallets }: { deviceId: string; personalOn: boolean; wallets?: WalletAccount[] | null }) {
  // One button per personal bKash account, "bKash 1" / "bKash 2" (owner 2026-11-17), plus one for all of them.
  const accounts = personalAccounts(wallets).filter((w) => w.provider === "bkash");
  const [last, setLast] = useState<PhoneCommand | null>(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    const { data } = await sb
      .from("phone_commands")
      .select("id,kind,provider,status,balance,error,created_at,finished_at,screens")
      .eq("device_id", deviceId)
      .eq("kind", PERSONAL_BALANCE_KIND)
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

  async function ask(account: number | null) {
    setProblem("");
    setBusy(true);
    const { error } = await sb.rpc("queue_personal_balance", { p_device: deviceId, p_account: account });
    setBusy(false);
    if (error) return setProblem(error.message);
    nudgePhone(deviceId);
    await load();
  }

  const live = isLive(last);
  const rows = last && !live ? readPersonalBalances(last.screens) : [];
  let line = "";
  if (last?.status === "queued") line = "Waking the phone to take it now (within 30 seconds at worst)…";
  else if (last?.status === "running") line = "The phone is reading its personal bKash accounts…";
  else if (last && rows.length === 0 && last.status !== "done") {
    line = `${last.error === "unsupported" ? "That phone's PayTrace app is too old for this: update it with Update now." : errorText(last.error, "bKash")} (${when(last.finished_at ?? last.created_at)})`;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        {accounts.map((a) => {
          const old = a.n === 2 && !a.confirmed;
          return (
            <Button
              key={a.n}
              size="sm"
              variant="outline"
              onClick={() => void ask(a.n)}
              disabled={busy || live || !personalOn || old}
              title={old ? "Update this phone's PayTrace app first: its current version cannot check bKash 2 on its own." : personalOn ? `Dials *247# on bKash ${a.n}'s own SIM and reads its balance. Only reads.` : "Personal accounts are switched off for this phone (Send money tab)."}
            >
              <Wallet aria-hidden /> {live ? "Checking…" : `Check bKash ${a.n} (personal) · ${a.number}`}
            </Button>
          );
        })}
        {accounts.length !== 1 ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void ask(null)}
            disabled={busy || live || !personalOn}
            title={personalOn ? "Dials *247# on each personal bKash account's own SIM and reads its balance. Only reads." : "Personal accounts are switched off for this phone (Send money tab)."}
          >
            <Wallet aria-hidden /> {live ? "Checking…" : accounts.length > 1 ? "Check both personal bKash" : "Check personal bKash balance"}
          </Button>
        ) : null}
        {line ? <span role="status" className="text-sm text-muted-foreground">{line}</span> : null}
        {problem ? <span className="text-xs text-destructive">{problem}</span> : null}
      </div>
      {rows.length ? (
        <ul className="space-y-0.5 text-sm" role="status">
          {rows.map((r) => (
            <li key={r.account}>
              bKash {r.account} (personal) · {r.number} · SIM {r.sim}:{" "}
              {r.balance !== null ? <strong>{tk(r.balance)}</strong> : <span className="text-status-bad">{errorText(r.error, "bKash")}</span>}
            </li>
          ))}
          {last?.finished_at ? <li className="text-xs text-muted-foreground">Read {when(last.finished_at)}</li> : null}
        </ul>
      ) : null}
      {last && (last.status === "failed" || last.status === "cancelled") ? <PhoneTrace screens={last.screens} /> : null}
    </div>
  );
}
