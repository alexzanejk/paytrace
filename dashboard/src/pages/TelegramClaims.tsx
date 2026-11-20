import { useEffect, useState } from "react";
import { must, sb, TELEGRAM_URL } from "@/lib/supabase";
import { useQuery } from "@/hooks/useQuery";
import { Screen } from "@/components/Screen";
import { PageHeader } from "@/components/PageHeader";
import { Confirm } from "@/components/Confirm";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dhakaTime } from "@/lib/dayMoney";
import {
  REPLY_MODES, STATUS_ORDER, STATUS_WORDS, claimDetail, cleanTrx, connectState, needsOwner, paymentLine, periodRange, personLabel, statusCounts, taka,
  type Claim, type ClaimStatus, type ReplyMode, type TelegramChat, type TelegramSettings, type UserSummary,
} from "@/lib/telegram";

type Period = "today" | "7d" | "30d";
interface BotStatus { configured?: boolean; bot?: string | null; webhook_ok?: boolean; pending?: number; last_error?: string | null }

const toneOf = (s: ClaimStatus): "ok" | "warn" | "bad" | "idle" => (STATUS_WORDS[s].tone === "muted" ? "idle" : STATUS_WORDS[s].tone);

/** Calls the telegram function as the signed-in admin. */
async function botCall(action: "setup" | "status"): Promise<BotStatus & { success?: boolean; message?: string }> {
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { success: false, message: "Sign in again." };
  const res = await fetch(TELEGRAM_URL, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ action }) });
  return (await res.json().catch(() => ({ success: false, message: `HTTP ${res.status}` }))) as BotStatus & { success?: boolean; message?: string };
}

/** The photo of a claim, fetched with the admin's token (the bot token never reaches the browser). */
async function photoUrl(claimId: string): Promise<string> {
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in again.");
  const res = await fetch(`${TELEGRAM_URL}?photo=${encodeURIComponent(claimId)}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`The photo could not be fetched (HTTP ${res.status}).`);
  return URL.createObjectURL(await res.blob());
}

/** Telegram claims: what people posted in the payment group, which stored transaction each one names, and who is owed
 *  what. Step 2 of the Telegram plan: nothing here pays anyone. */
export function TelegramClaims() {
  const [period, setPeriod] = useState<Period>("today");
  const [filter, setFilter] = useState<ClaimStatus | "all" | "needs">("needs");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [bot, setBot] = useState<BotStatus | null>(null);

  const { data, error, loading, refresh } = useQuery(
    async () => {
      const { from, to } = periodRange(period);
      const [settings, chats, claims, users] = await Promise.all([
        sb.from("telegram_settings").select("group_chat_id,group_title,reply_mode,webhook_set_at,bot_username").eq("id", true).maybeSingle(),
        sb.from("telegram_chats").select("chat_id,title,kind,last_seen_at,messages").order("last_seen_at", { ascending: false }).limit(20),
        sb.rpc("tg_claims", { p_from: from.toISOString(), p_to: to.toISOString(), p_status: null }),
        sb.rpc("tg_user_summary", { p_from: from.toISOString() }),
      ]);
      return {
        settings: (must(settings) as TelegramSettings | null),
        chats: must(chats) as TelegramChat[],
        claims: (must(claims) as Claim[] | null) ?? [],
        users: (must(users) as UserSummary[] | null) ?? [],
      };
    },
    [period],
    { refreshMs: 20000 },
  );

  useEffect(() => {
    let alive = true;
    botCall("status").then((s) => { if (alive) setBot(s); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const claims = data?.claims ?? [];
  const counts = statusCounts(claims);
  const shown = filter === "all" ? claims : filter === "needs" ? claims.filter((c) => c.status === "conflict" || c.status === "review" || c.status === "unmatched") : claims.filter((c) => c.status === filter);
  const connect = connectState(data?.settings ?? null, bot);

  async function act(key: string, run: () => PromiseLike<{ error: { message: string } | null } | void>, done: string) {
    setBusy(key);
    setNote("");
    try {
      const r = await run();
      if (r && r.error) setNote(r.error.message);
      else setNote(done);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Something went wrong.");
    }
    setBusy(null);
    refresh();
  }

  async function connectBot() {
    setBusy("connect");
    setNote("");
    const r = await botCall("setup");
    setNote(r.success ? `Connected as @${r.bot}. Now add the bot to the group (as an admin), post one message there, and pick the group below.` : (r.message ?? "Could not connect."));
    setBot(await botCall("status").catch(() => null));
    setBusy(null);
    refresh();
  }

  return (
    <Screen loading={loading} error={error} hasData={!!data}>
      <PageHeader
        title="Telegram"
        description="Payment screenshots posted in your group, matched to the transactions PayTrace holds."
        help={
          <>
            <p>The bot receives every message of the chosen group. A photo is read by the OCR worker on your VPS; the TrxID it finds, or one typed as text, is looked for among the transactions PayTrace holds that are not paid out yet. Found: the post gets a thumbs-up from the bot and is tied to the person (the site login they typed in the group, else their Telegram profile). Not found, already paid out, or unclear: nothing happens to the post.</p>
            <p className="mt-2">A screenshot never proves a payment by itself; a held transaction stays held. One TrxID is one claim: the same person again is a duplicate, another person first is a conflict for you to decide. Nothing on this page pays anyone: the Payout page does that, and "who is owed what" below is what it will start from.</p>
          </>
        }
      />
      {note ? <p className="mb-4 rounded-lg border border-status-warn bg-status-warn-bg p-3 text-sm text-status-warn" role="status">{note}</p> : null}

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold">The bot</h3>
            <p className="break-words text-sm text-muted-foreground">{connect.line} {connect.next}</p>
            {bot?.last_error ? <p className="mt-1 text-xs text-status-warn">Telegram's last error: {bot.last_error}{bot.pending ? ` · ${bot.pending} waiting` : ""}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant={connect.state === "ready" ? "outline" : "default"} disabled={busy === "connect"} onClick={connectBot}>
              {connect.state === "ready" ? "Reconnect" : "Connect the bot"}
            </Button>
            <Button size="sm" variant="ghost" onClick={async () => setBot(await botCall("status").catch(() => null))}>Check</Button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="min-w-0">
            <label className="text-xs text-muted-foreground">The group the bot listens to</label>
            <Select value={data?.settings?.group_chat_id ? String(data.settings.group_chat_id) : ""} onValueChange={(v) => act("group", () => sb.rpc("tg_set_group", { p_chat_id: Number(v) }), "Group chosen. Messages posted there from now on are kept.")}>
              <SelectTrigger className="min-w-0 [&>span]:truncate"><SelectValue placeholder={data?.chats.length ? "Pick the group" : "No chat seen yet: post one message in the group"} /></SelectTrigger>
              <SelectContent>
                {(data?.chats ?? []).map((c) => (
                  <SelectItem key={c.chat_id} value={String(c.chat_id)}>{c.title || c.chat_id} · {c.kind} · {c.messages} msg</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0">
            <label className="text-xs text-muted-foreground">Text replies in the group (the thumbs-up on a match is always on)</label>
            <Select value={data?.settings?.reply_mode ?? "problems"} onValueChange={(v) => act("mode", () => sb.rpc("tg_set_reply_mode", { p_mode: v as ReplyMode }), "Saved.")}>
              <SelectTrigger className="min-w-0 [&>span]:truncate"><SelectValue /></SelectTrigger>
              <SelectContent>
                {REPLY_MODES.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">{REPLY_MODES.find((m) => m.id === (data?.settings?.reply_mode ?? "problems"))?.meaning}</p>
          </div>
        </div>
      </Card>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(["today", "7d", "30d"] as Period[]).map((p) => (
          <Button key={p} size="sm" variant={period === p ? "default" : "outline"} onClick={() => setPeriod(p)}>{p === "today" ? "Today" : p === "7d" ? "7 days" : "30 days"}</Button>
        ))}
        <span className="mx-1 text-muted-foreground">·</span>
        <Button size="sm" variant={filter === "needs" ? "default" : "outline"} onClick={() => setFilter("needs")}>Needs you ({needsOwner(counts)})</Button>
        <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>All ({claims.length})</Button>
        {STATUS_ORDER.filter((s) => counts[s] > 0).map((s) => (
          <Button key={s} size="sm" variant={filter === s ? "default" : "outline"} onClick={() => setFilter(s)}>{STATUS_WORDS[s].label} ({counts[s]})</Button>
        ))}
      </div>

      <div className="grid gap-3">
        {shown.length === 0 ? <Card className="p-6 text-center text-sm text-muted-foreground">{claims.length === 0 ? "No messages kept in this period yet." : "Nothing in this view."}</Card> : null}
        {shown.map((c) => <ClaimRow key={c.id} claim={c} busy={busy} act={act} />)}
      </div>

      <UsersCard users={data?.users ?? []} />
    </Screen>
  );
}

function ClaimRow({ claim: c, busy, act }: { claim: Claim; busy: string | null; act: (key: string, run: () => PromiseLike<{ error: { message: string } | null } | void>, done: string) => Promise<void> }) {
  const [pick, setPick] = useState("");
  const [picking, setPicking] = useState(false);
  const [img, setImg] = useState<string | null>(null);
  const [imgErr, setImgErr] = useState("");
  const w = STATUS_WORDS[c.status];
  const detail = claimDetail(c);

  async function showPhoto() {
    if (img) { setImg(null); return; }
    setImgErr("");
    try { setImg(await photoUrl(c.id)); } catch (e) { setImgErr(e instanceof Error ? e.message : "no photo"); }
  }

  async function pickTrx() {
    const trx = cleanTrx(pick);
    if (trx.length < 6) return;
    await act(`pick:${c.id}`, async () => {
      const { data: rows, error } = await sb.from("payments").select("id,trx_id,provider,amount").eq("trx_id", trx).limit(2);
      if (error) return { error };
      if (!rows || rows.length === 0) return { error: { message: `PayTrace holds no transaction with TrxID ${trx}.` } };
      if (rows.length > 1) return { error: { message: `TrxID ${trx} exists on two wallets; pick it on the Transactions page instead.` } };
      return sb.rpc("tg_claim_pick", { p_claim: c.id, p_payment: rows[0].id });
    }, `Claim tied to TrxID ${trx}.`);
    setPicking(false);
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={toneOf(c.status)} title={w.meaning}>{w.label}</Badge>
            {c.reacted ? <span title="The bot put a thumbs-up on this post" aria-label="thumbs-up sent">👍</span> : null}
            <span className="font-medium">{personLabel(c)}</span>
            <span className="text-xs text-muted-foreground">id {c.tg_user_id} · {dhakaTime(c.sent_at)} · {c.kind === "photo" ? "photo" : "text"}</span>
          </div>
          <p className="mt-1 text-sm">{paymentLine(c.payment)}</p>
          {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
          {c.kind === "text" && c.payment === null && c.candidates.length === 0 ? <p className="text-xs text-muted-foreground">no TrxID-shaped text in the message</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {c.kind === "photo" ? <Button size="sm" variant="outline" onClick={showPhoto}>{img ? "Hide photo" : "Photo"}</Button> : null}
          {c.status !== "ignored" ? (
            <Button size="sm" variant="outline" onClick={() => setPicking((v) => !v)}>Pick transaction</Button>
          ) : null}
          {c.status === "held" || c.status === "review" ? (
            <Button size="sm" variant="ghost" disabled={busy === `re:${c.id}`} onClick={() => act(`re:${c.id}`, () => sb.rpc("tg_claim_rejudge", { p_claim: c.id }), "Checked again.")}>Check again</Button>
          ) : null}
          {c.status !== "ignored" ? (
            <Confirm title="Ignore this message?" description="It stays in the list as ignored and counts for nothing. The transaction itself is not touched." confirmLabel="Ignore" onConfirm={() => act(`ig:${c.id}`, () => sb.rpc("tg_claim_ignore", { p_claim: c.id, p_note: "ignored on the dashboard" }), "Ignored.")}>
              <Button size="sm" variant="ghost" disabled={busy === `ig:${c.id}`}>Ignore</Button>
            </Confirm>
          ) : null}
        </div>
      </div>
      {picking ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input value={pick} onChange={(e) => setPick(e.target.value)} placeholder="TrxID as PayTrace holds it" className="w-56" aria-label="TrxID" />
          <Button size="sm" disabled={cleanTrx(pick).length < 6 || busy === `pick:${c.id}`} onClick={pickTrx}>Tie to this TrxID</Button>
          <span className="text-xs text-muted-foreground">The duplicate and held rules still apply.</span>
        </div>
      ) : null}
      {imgErr ? <p className="mt-2 text-xs text-status-warn">{imgErr}</p> : null}
      {img ? <img src={img} alt="the posted screenshot" className="mt-3 max-h-[70vh] max-w-full rounded-lg border" /> : null}
    </Card>
  );
}

function UsersCard({ users }: { users: UserSummary[] }) {
  const owed = users.filter((u) => u.matched > 0);
  return (
    <Card className="mt-6 p-4">
      <h3 className="font-semibold">Who is owed what (this period)</h3>
      <p className="mb-3 text-sm text-muted-foreground">Matched transactions not yet in a payout, per person. Paying them is the Payout page's job; this list is what the next step will pay from.</p>
      {owed.length === 0 ? <p className="text-sm text-muted-foreground">Nobody yet.</p> : (
        <div className="grid gap-2">
          {owed.map((u) => (
            <div key={u.tg_user_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
              <div className="min-w-0">
                <span className="font-medium">{personLabel(u)}</span>
                <span className="ml-2 text-xs text-muted-foreground">id {u.tg_user_id}{u.last_number ? ` · last paid to ${u.last_number}` : ""}</span>
                <div className="text-xs text-muted-foreground">
                  {u.matched} matched{u.held ? ` · ${u.held} held` : ""}{u.open ? ` · ${u.open} to look at` : ""}{u.conflicts ? ` · ${u.conflicts} conflict` : ""} · last {dhakaTime(u.last_at)}
                </div>
              </div>
              <div className="text-base font-semibold tabular-nums">{taka(u.matched_total)}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
