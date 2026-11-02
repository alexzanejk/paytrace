import { useCallback, useEffect, useRef, useState } from "react";
import { FileClock, Search } from "lucide-react";
import { sb } from "@/lib/supabase";
import { tk, when } from "@/lib/format";
import { isLive, POLL_MS, errorText, type PhoneCommand } from "@/lib/phoneCommands";
import {
  readList, readDetail, unreadLines, matchRow, statementSummary, type RowMatch, type StatementRow,
} from "@/lib/statement";
import { Button } from "@/components/ui/button";

interface StatementCommand extends PhoneCommand {
  item: number | null;
  screens: string[] | null;
}

const COLUMNS = "grid grid-cols-[2.2rem_5.5rem_1fr_auto] gap-x-3 gap-y-1 items-baseline";

/** Asks this phone for the wallet's own statement, and says which of those transactions PayTrace never received.
 *
 *  This is the answer to "the balance does not match": the wallet's list is the truth about what happened, and any
 *  Cash Out on it that PayTrace has no payment for is an SMS that never arrived. Nothing is sent and nothing is
 *  changed — it only reads. Opening one entry asks the phone again and brings back that entry's own screen, which
 *  carries the TrxID, the full numbers and the exact time.
 */
export function StatementCheck({ deviceId, provider = "bkash" }: { deviceId: string; provider?: "nagad" | "bkash" }) {
  const label = provider === "bkash" ? "bKash" : "Nagad";
  const [last, setLast] = useState<StatementCommand | null>(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [payments, setPayments] = useState<{ trx_id: string; amount: number; occurred_at: string | null; created_at: string }[]>([]);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    const { data } = await sb
      .from("phone_commands")
      .select("id,kind,provider,status,balance,error,created_at,finished_at,item,screens")
      .eq("device_id", deviceId)
      .eq("kind", "statement")
      .eq("provider", provider)
      .order("created_at", { ascending: false })
      .limit(1);
    setLast(((data ?? [])[0] as StatementCommand | undefined) ?? null);
  }, [deviceId, provider]);

  // The phone's own payments of the last few weeks, to say which statement lines PayTrace already holds.
  const loadPayments = useCallback(async () => {
    const since = new Date(Date.now() - 45 * 864e5).toISOString();
    const { data } = await sb
      .from("payments")
      .select("trx_id,amount,occurred_at,created_at")
      .eq("device_id", deviceId)
      .eq("provider", provider)
      .gte("created_at", since)
      .limit(500);
    setPayments((data ?? []) as typeof payments);
  }, [deviceId, provider]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!isLive(last)) return;
    timer.current = window.setTimeout(() => void load(), POLL_MS);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [last, load]);

  useEffect(() => { if (last?.status === "done" && last.item == null) void loadPayments(); }, [last, loadPayments]);

  async function ask(item: number | null) {
    setProblem("");
    setBusy(true);
    const { error } = await sb.rpc("queue_statement_command", { p_device: deviceId, p_provider: provider, p_item: item });
    setBusy(false);
    if (error) return setProblem(error.message);
    await load();
  }

  const screens = last?.status === "done" ? last.screens : null;
  const rows: StatementRow[] = last?.item == null ? readList(screens) : [];
  const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });
  const matches: RowMatch[] = rows.map((r) => matchRow(r, payments, dayOf));
  const detail = last?.item != null && screens && screens.length > 0 ? readDetail(screens[screens.length - 1]) : null;
  const odd = last?.item == null ? unreadLines(screens) : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="outline" onClick={() => void ask(null)} disabled={busy || isLive(last)}>
          <FileClock aria-hidden /> {isLive(last) ? "Asking the phone…" : `Get ${label} statement`}
        </Button>
        {last ? (
          <span role="status" className="text-sm text-muted-foreground">
            {last.status === "queued" ? "Waiting for the phone to pick it up (it checks every 30 seconds)…"
              : last.status === "running" ? "The phone is reading the wallet's menu…"
              : last.status === "done" ? `${last.item == null ? "Statement" : `Entry ${last.item}`} read ${when(last.finished_at ?? last.created_at)}`
              : `It did not work (${when(last.finished_at ?? last.created_at)}). ${errorText(last.error)}`}
          </span>
        ) : null}
        {problem ? <span className="text-xs text-destructive">{problem}</span> : null}
      </div>

      {last?.status === "done" && last.item == null && rows.length > 0 ? (
        <div className="rounded-lg border bg-card p-3 text-sm">
          <p className="mb-2 font-medium">{statementSummary(rows, matches)}</p>
          <div className={COLUMNS}>
            {rows.map((row, i) => (
              <Row key={row.no} row={row} match={matches[i]} onOpen={() => void ask(row.no)} busy={busy || isLive(last)} />
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            The wallet's own list gives only the day, the kind and the amount. Open an entry to get its TrxID, both
            numbers and the exact time — that asks the phone again, so it takes about a minute.
          </p>
          {odd.length > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Lines PayTrace could not read: {odd.join(" · ")}
            </p>
          ) : null}
        </div>
      ) : null}

      {detail ? (
        <div className="rounded-lg border bg-card p-3 text-sm">
          <p className="mb-2 font-medium">Entry {last?.item} as the wallet wrote it</p>
          <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1">
            <Field name="What" value={detail.type} />
            <Field name="Amount" value={detail.amount == null ? null : tk(Math.abs(detail.amount))} />
            <Field name="Fee" value={detail.fee == null ? null : tk(detail.fee)} />
            <Field name="From" value={detail.from} />
            <Field name="To" value={detail.to} />
            <Field name="TrxID" value={detail.trxId} />
            <Field name="At" value={detail.at} />
          </dl>
          <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">{detail.raw}</pre>
        </div>
      ) : null}
    </div>
  );
}

function Field({ name, value }: { name: string; value: string | null }) {
  if (!value) return null;
  return (
    <>
      <dt className="text-muted-foreground">{name}</dt>
      <dd className="font-medium break-all">{value}</dd>
    </>
  );
}

const MATCH_TEXT: Record<RowMatch, { text: string; cls: string }> = {
  have: { text: "we have it", cls: "text-emerald-600 dark:text-emerald-400" },
  missing: { text: "MISSING", cls: "text-destructive font-semibold" },
  unknown: { text: "no SMS expected", cls: "text-muted-foreground" },
};

function Row({ row, match, onOpen, busy }: { row: StatementRow; match: RowMatch; onOpen: () => void; busy: boolean }) {
  const m = MATCH_TEXT[match];
  return (
    <>
      <span className="text-muted-foreground tabular-nums">{row.no}</span>
      <span className="tabular-nums">{row.date}</span>
      <span>
        {row.type} <span className="tabular-nums">{tk(Math.abs(row.amount))}</span>
        {row.amount < 0 ? <span className="text-muted-foreground"> (out)</span> : null}
        <span className={"ml-2 text-xs " + m.cls}>{m.text}</span>
      </span>
      <Button size="sm" variant="ghost" onClick={onOpen} disabled={busy} title={`Open entry ${row.no} on the phone`}>
        <Search aria-hidden /> Open
      </Button>
    </>
  );
}
