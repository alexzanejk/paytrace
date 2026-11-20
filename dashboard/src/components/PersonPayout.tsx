import { useMemo, useState } from "react";
import { HandCoins } from "lucide-react";
import { sb } from "@/lib/supabase";
import { tk } from "@/lib/format";
import { nudgePhone } from "@/lib/wake";
import { personLabel, type Claim, type UserSummary } from "@/lib/telegram";
import { checkNumbers, groupDigits, parseFee, parsePct, sendProblem, senderOptions, splitPayout, ROCKET_NOTE } from "@/lib/payouts";
import { preferredSender } from "@/lib/payoutPlans";
import { type SendWay, wayWords } from "@/lib/sendWay";
import { SendWayChoice } from "@/components/SendWayChoice";
import { MoneyConfirm } from "@/components/MoneyConfirm";
import { ProviderChip } from "@/components/ProviderChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { useDevices } from "@/hooks/useDevices";

/** "Pay out" for one Telegram person (step 4, owner 2026-11-20): all of their matched transactions in one send to a
 *  number typed twice, from a wallet of yours. It is queued on the server and sent when that phone is free, so several
 *  people can be paid one after another without watching. The same rules as the Payout page apply on the server. */
export function PersonPayout({ user, claims, devices, defaultPct, defaultFee, onDone, onClose }: {
  user: UserSummary;
  claims: Claim[];
  devices: ReturnType<typeof useDevices>;
  defaultPct: number;
  defaultFee: number;
  onDone: () => void;
  onClose: () => void;
}) {
  const mine = useMemo(() => claims.filter((c) => c.tg_user_id === user.tg_user_id && c.status === "matched" && c.payment), [claims, user.tg_user_id]);
  const [off, setOff] = useState<Set<string>>(new Set());
  const chosen = mine.filter((c) => !off.has(c.payment!.id));
  const total = chosen.reduce((s, c) => s + Number(c.payment!.amount), 0);
  const options = useMemo(() => senderOptions(devices.list.map((d) => ({ id: d.id, name: devices.nameOf(d.id), status: d.status, allow_cashin: d.allow_cashin, allow_personal: d.allow_personal, info: d.info }))), [devices]);
  const preferred = useMemo(() => preferredSender(options, mine.map((c) => ({ provider: c.payment!.provider }))), [options, mine]);
  const [senderKey, setSenderKey] = useState(preferred?.key ?? "");
  const sender = options.find((o) => o.key === senderKey) ?? preferred;
  const [way, setWay] = useState<SendWay>("ussd");
  const [pctText, setPctText] = useState(String(defaultPct));
  const [first, setFirst] = useState(user.last_number ?? "");
  const [second, setSecond] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  const personal = sender?.account === "personal";
  const fee = personal ? defaultFee : 0;
  const pct = parsePct(pctText);
  const split = pct == null ? null : splitPayout(total, pct, parseFee(String(fee)) ?? 0);
  const nums = checkNumbers(first, second);
  const size = split ? sendProblem(split.send, personal ? "send_money" : "cash_in") : "";
  const blocked = chosen.length === 0 ? "Tick at least one transaction."
    : pct == null ? "Type the share you keep (0 to 100)."
    : !sender ? "No wallet of yours can send right now (switch sending on for a phone)."
    : sender.why ? sender.why : size || nums.problem;

  async function go() {
    if (!split || pct == null || !sender || !nums.number) return;
    setBusy(true); setProblem("");
    const { data, error } = await sb.rpc("queue_payout", {
      // The server names the plan after the person (the Telegram @username), the same name the transactions carry.
      p_label: null, p_tg_user: user.tg_user_id, p_payments: chosen.map((c) => c.payment!.id),
      p_device: sender.deviceId, p_provider: sender.provider, p_to_number: nums.number, p_keep_pct: pct,
      p_from_account: sender.account, p_via: way, p_account: sender.account === "personal" ? sender.personalN ?? 1 : null, p_note: note || null,
    });
    setBusy(false);
    if (error) { setProblem(error.message.replace(/^send_money_not_ready: /, "")); setConfirming(false); return; }
    const plan = data as { status?: string } | null;
    if (plan?.status === "sending") nudgePhone(sender.deviceId);
    onDone();
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-primary/40 p-3 text-sm" aria-label={`Pay out ${personLabel(user)}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-semibold"><HandCoins className="mr-1 inline h-4 w-4" aria-hidden /> Pay out {personLabel(user)}: {tk(total)}</h4>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
      <ul className="max-h-48 divide-y divide-border overflow-auto rounded-lg border border-border" aria-label="Transactions in this payout">
        {mine.map((c) => {
          const p = c.payment!;
          return (
            <li key={p.id} className="flex items-center gap-2 px-3 py-1.5">
              <input type="checkbox" className="h-4 w-4 accent-[var(--color-primary)]" checked={!off.has(p.id)} aria-label={`Include ${p.trx_id}`}
                onChange={() => setOff((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} />
              <ProviderChip provider={p.provider} />
              <span className="font-mono text-xs">{p.trx_id}</span>
              <span className="hidden text-xs text-muted-foreground sm:inline">{p.phone ?? ""}</span>
              <span className="ml-auto font-medium tabular-nums">{tk(Number(p.amount))}</span>
            </li>
          );
        })}
      </ul>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="space-y-1">
          <span className="text-muted-foreground">You keep (%)</span>
          <Input value={pctText} onChange={(e) => setPctText(e.target.value)} inputMode="decimal" aria-label="Share you keep" />
          {split ? <span className="block text-xs text-muted-foreground">Kept {tk(split.keep)}{fee ? `, bKash fee ${tk(fee)} set aside` : ""}. Sent: <b>{tk(split.send)}</b></span> : null}
        </label>
        <label className="space-y-1 md:col-span-2">
          <span className="text-muted-foreground">Send from</span>
          <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={sender?.key ?? ""} onChange={(e) => setSenderKey(e.target.value)} aria-label="Send from">
            {options.map((o) => <option key={o.key} value={o.key} disabled={!!o.why}>{o.label}{o.why ? " (cannot send now)" : ""}</option>)}
          </select>
          {sender?.provider === "rocket" ? <span className="block text-xs text-muted-foreground">{ROCKET_NOTE}</span> : null}
        </label>
      </div>
      {sender && !personal ? <SendWayChoice deviceId={sender.deviceId} provider={sender.provider} account={sender.account} value={way} onChange={setWay} /> : null}
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-muted-foreground">Number to send to{user.last_number ? " (last time: " + groupDigits(user.last_number) + ")" : ""}</span>
          <Input value={first} onChange={(e) => setFirst(e.target.value)} inputMode="numeric" placeholder="01XXXXXXXXX" aria-label="Number to send to" />
        </label>
        <label className="space-y-1">
          <span className="text-muted-foreground">Type it again</span>
          <Input value={second} onChange={(e) => setSecond(e.target.value)} onPaste={(e) => e.preventDefault()} inputMode="numeric" placeholder="01XXXXXXXXX" aria-label="Type the number again" />
        </label>
      </div>
      {nums.number ? <p className="text-lg font-semibold tracking-wider tabular-nums">{groupDigits(nums.number)}</p> : null}
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Note" maxLength={200} />
      {problem ? <p className="text-status-bad">{problem}</p> : null}
      {!confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!!blocked || busy} onClick={() => setConfirming(true)}>Queue this payout</Button>
          {blocked ? <span className="text-xs text-muted-foreground">{blocked}</span> : <span className="text-xs text-muted-foreground">Sent when the phone is free; several people queue one after another.</span>}
        </div>
      ) : split && sender && nums.number ? (
        <MoneyConfirm
          yes="Yes, queue it"
          busy={busy}
          onYes={go}
          onBack={() => setConfirming(false)}
          note={`Sent ${wayWords(way, sender.provider)}. You keep ${tk(split.keep)} (${pct}%). If the phone is busy it waits its turn; a transaction can be in one payout only, so nothing is paid twice.`}
        >
          Send <b>{tk(split.send)}</b> to <b>{groupDigits(nums.number)}</b> for {personLabel(user)} ({chosen.length} transaction{chosen.length === 1 ? "" : "s"}, {tk(total)}) from {sender.label}.
        </MoneyConfirm>
      ) : null}
    </div>
  );
}
