import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { sb } from "@/lib/supabase";
import { tk, when } from "@/lib/format";
import { errorText, isLive, POLL_MS, type PhoneCommand } from "@/lib/phoneCommands";
import { bestPhone, maskNumber, nagadMask, outcomeWords, phoneChoices, planSearch, queueErrorText, readSearch, SEARCH_APP_LABEL, SEARCH_RPC, searchPhones, searchQuery, type SearchApp, type SearchKind, type Seen } from "@/lib/appSearch";
import { nudgePhone } from "@/lib/wake";
import { reviewReasonText } from "@/lib/reasons";
import { useDevices } from "@/hooks/useDevices";
import { StatusBadge } from "@/components/StatusBadge";
import { PhoneTrace } from "@/components/PhoneTrace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

interface Known { trx_id: string; status: string; review_reason: string | null; amount: number; provider: string; device_id: string | null; received_at: string }
interface Answer { deviceId: string; cmd: PhoneCommand | null; problem?: string }

/** The shared error texts speak of the bKash app; for a Nagad search they mean the Nagad app. */
const appWords = (t: string, app: SearchApp) => (app === "nagad" ? t.replace(/bKash/g, "Nagad") : t);

const TONE: Record<string, string> = { ok: "text-emerald-700 dark:text-emerald-400", warn: "text-amber-700 dark:text-amber-400", idle: "text-muted-foreground" };

/** "Search the bKash app" (owner 2026-11-11): type a TrxID or a customer's number, and a phone looks it up in its own bKash
 *  agent app (Statements search). Read only; a held payment whose TrxID is found there is released by the server. */
export function AppSearch({ initial }: { initial?: string } = {}) {
  const devices = useDevices(30000);
  const [app, setApp] = useState<SearchApp>("bkash");
  const choices = phoneChoices(devices.list, Date.now(), app);
  const phones = choices.filter((p) => p.canSearch);
  const appName = SEARCH_APP_LABEL[app];
  const wallet = app === "nagad" ? "Nagad" : "bKash";
  const [text, setText] = useState(initial ?? "");
  const [choice, setChoice] = useState("auto");
  const [problem, setProblem] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<SearchKind>("trx");
  const [known, setKnown] = useState<Known[] | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** Queues one search, wakes the phone, and waits for its answer (about a minute). */
  async function askPhone(deviceId: string, query: string, inApp: SearchApp): Promise<Answer> {
    const { data, error } = await sb.rpc(SEARCH_RPC[inApp], { p_device: deviceId, p_query: query });
    if (error) return { deviceId, cmd: null, problem: queueErrorText(error.message) };
    nudgePhone(deviceId);
    const id = data as string;
    let cmd: PhoneCommand | null = null;
    for (let i = 0; i < 80 && alive.current; i++) {
      const r = await sb.from("phone_commands").select("id,kind,provider,status,balance,error,created_at,finished_at,screens").eq("id", id).maybeSingle();
      cmd = (r.data as PhoneCommand | null) ?? cmd;
      setAnswers((a) => a.map((x) => (x.deviceId === deviceId ? { ...x, cmd } : x)));
      if (cmd && !isLive(cmd)) break;
      await wait(POLL_MS);
    }
    return { deviceId, cmd };
  }

  async function run() {
    setProblem("");
    setNote("");
    const q = searchQuery(text);
    if (!q) return setProblem("Type a TrxID (like DKB6CCN518) or an 11-digit number (01…).");
    setKind(q.kind);
    setBusy(true);
    setAnswers([]);
    // What PayTrace itself knows: the SMS with this TrxID, or the SMS from this number.
    const k = q.kind === "trx"
      ? await sb.from("payments").select("trx_id,status,review_reason,amount,provider,device_id,received_at").eq("trx_id", q.query).limit(5)
      : await sb.from("payments").select("trx_id,status,review_reason,amount,provider,device_id,received_at").in("counterparty", [q.query, maskNumber(q.query), nagadMask(q.query)]).order("received_at", { ascending: false }).limit(5);
    const rows = (k.data ?? []) as Known[];
    setKnown(rows);
    // A deposit order where a customer typed this TrxID names the phone whose number they were shown.
    const typed = q.kind === "trx"
      ? ((await sb.from("orders").select("device_id,provider").ilike("claimed_trx_id", q.query).order("created_at", { ascending: false }).limit(5)).data ?? []) as Seen[]
      : [];
    const best = bestPhone(rows.map((r) => ({ device_id: r.device_id, provider: r.provider })), typed);
    // The TrxID's own wallet decides which app is searched.
    const inApp: SearchApp = best.app ?? app;
    const switched = inApp !== app;
    if (switched) setApp(inApp);
    const plan = planSearch(choice, searchPhones(devices.list, Date.now(), inApp), best, nameOf);
    setNote([switched ? `This is a ${inApp === "nagad" ? "Nagad" : "bKash"} transaction, so the ${SEARCH_APP_LABEL[inApp]} is searched.` : "", plan.note].filter(Boolean).join(" "));
    if (plan.targets.length === 0) { setBusy(false); return setProblem(plan.problem); }
    for (const deviceId of plan.targets) {
      if (!alive.current) return;
      setAnswers((a) => [...a, { deviceId, cmd: null }]);
      const ans = await askPhone(deviceId, q.query, inApp);
      setAnswers((a) => a.map((x) => (x.deviceId === deviceId ? ans : x)));
      // A TrxID is in one wallet only: stop at the first phone that finds it.
      if (q.kind === "trx" && readSearch(ans.cmd?.screens)?.found) break;
    }
    if (alive.current) setBusy(false);
  }

  function nameOf(id: string) { return choices.find((p) => p.id === id)?.name ?? devices.nameOf(id); }

  return (
    <Card className="mb-4 p-4">
      <div className="mb-1 flex flex-wrap items-center gap-2 font-semibold">
        <Search className="h-4 w-4" aria-hidden /> Search the
        <span className="inline-flex gap-1" role="radiogroup" aria-label="Which wallet app">
          {(["bkash", "nagad"] as const).map((a) => (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={app === a}
              disabled={busy}
              onClick={() => { setApp(a); setAnswers([]); }}
              className={`rounded-md border px-2 py-0.5 text-sm ${app === a ? "border-primary bg-primary text-primary-foreground" : "bg-card"}`}
            >
              {SEARCH_APP_LABEL[a]}
            </button>
          ))}
        </span>
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        A phone opens its {wallet} agent app, searches its statement and shows what {wallet} itself has. It only reads. A held
        payment whose TrxID is found there is released by itself. Takes about a minute per phone.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !busy) void run(); }}
          placeholder="TrxID or customer number"
          aria-label="TrxID or customer number"
          className="w-full sm:w-64"
          autoCapitalize="characters"
          spellCheck={false}
        />
        <select
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          aria-label="Which phone"
          className="h-10 w-[calc(50%-0.25rem)] rounded-lg border border-input bg-card px-3 text-sm sm:w-56"
        >
          <option value="auto">Best phone (where the SMS arrived)</option>
          <option value="all">All phones, one after another</option>
          {choices.map((p) => (
            <option key={p.id} value={p.id} disabled={!p.canSearch}>
              {p.name}{!p.canSearch ? " (update app to search)" : p.online ? "" : " (offline)"}
            </option>
          ))}
        </select>
        <Button size="sm" onClick={() => void run()} disabled={busy || !text.trim()}>
          <Search aria-hidden /> {busy ? "Searching…" : "Search"}
        </Button>
      </div>
      {note ? <p className="mt-2 text-sm text-muted-foreground">{note}</p> : null}
      {problem ? <p className="mt-2 text-sm text-destructive">{problem}</p> : null}
      {phones.length === 0 && !devices.loading ? (
        <p className="mt-2 text-xs text-muted-foreground">No phone can search yet: each needs the newest PayTrace app.</p>
      ) : null}

      {known ? (
        <div className="mt-3 rounded-lg border bg-muted/30 p-3 text-sm">
          <div className="mb-1 font-medium">What PayTrace has</div>
          {known.length === 0 ? (
            <p className="text-muted-foreground">{kind === "trx" ? "PayTrace never got an SMS with this TrxID." : "PayTrace has no SMS from this number."}</p>
          ) : (
            <ul className="space-y-1">
              {known.map((r) => (
                <li key={r.trx_id + r.received_at} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{r.trx_id}</span>
                  <span>{tk(r.amount)}</span>
                  <StatusBadge status={r.status} />
                  {r.status === "review" && r.review_reason ? <span className="text-xs text-muted-foreground">{reviewReasonText(r.review_reason)}</span> : null}
                  <span className="text-xs text-muted-foreground">{devices.nameOf(r.device_id)} · {when(r.received_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {answers.map((a) => {
        const r = readSearch(a.cmd?.screens);
        const words = r ? outcomeWords(r, kind) : null;
        return (
          <div key={a.deviceId} className="mt-3 rounded-lg border p-3 text-sm">
            <div className="mb-1 font-medium">{nameOf(a.deviceId)}</div>
            {a.problem ? <p className="text-destructive">{a.problem}</p>
              : !a.cmd || isLive(a.cmd) ? <p className="text-muted-foreground">{a.cmd?.status === "running" ? `The phone is searching its ${appName} (about a minute)…` : "Waking the phone…"}</p>
              : a.cmd.status !== "done" ? <p className="text-amber-700 dark:text-amber-400">The search did not work. {appWords(errorText(a.cmd.error, wallet), app)}</p>
              : words ? <p className={TONE[words.tone]}>{appWords(words.text, app)}</p>
              : <p className="text-muted-foreground">The phone answered, but not with a search result. Update its PayTrace app.</p>}
            {r && r.rows.length ? (
              <ul className="mt-2 space-y-1">
                {r.rows.map((row) => <li key={row} className="break-words rounded bg-muted/40 px-2 py-1 font-mono text-xs">{row}</li>)}
              </ul>
            ) : null}
            {r?.sheet ? <p className="mt-2 break-words text-xs text-muted-foreground">Details: {r.sheet}</p> : null}
            {a.cmd && a.cmd.status !== "done" && !isLive(a.cmd) ? <PhoneTrace screens={a.cmd.screens} /> : null}
          </div>
        );
      })}
    </Card>
  );
}
