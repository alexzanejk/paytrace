import { useState } from "react";
import { Landmark } from "lucide-react";
import { sb } from "@/lib/supabase";
import { tk, when } from "@/lib/format";
import { PROVIDER_LABEL } from "@/lib/types";
import type { DeviceBalance } from "@/lib/types";
import { parseOpening, recentB2BOut, type B2BFloatRow } from "@/lib/ledger";
import { floatWarning, gapChoices, gapLine, gapStatus, heldBack, openGapsOf, ownMoneyOf, type GapRow } from "@/lib/gaps";
import { openLedgerFor } from "@/lib/ledgerNav";
import { Disclosure } from "@/components/Disclosure";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const WALLETS = ["bkash", "nagad", "rocket"] as const;

/** The B2B float of each wallet on this phone (owner 2026-11-05): distributor money the owner does not count as theirs.
 *  Float = the opening amount typed here + B2B in - B2B out since then (from the ledger, so a statement-only line counts).
 *  Jobs start from "your money" = balance minus what is held back: the float (never below zero) plus every amount that
 *  came in with no SMS and is not explained yet (migration 063: rubel's bKash took Tk 7,000 of B2B on 7 Nov, bKash sent
 *  no SMS, the statement was never pulled in time, and the whole balance read as the owner's). A B2B OUT in the last
 *  24 hours is shown in red. */
export function B2BFloat({ deviceId, floats, loadError = "", balances, gaps = [], onChanged }: {
  deviceId: string; floats: B2BFloatRow[]; loadError?: string; balances: DeviceBalance[]; gaps?: GapRow[]; onChanged: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  const shown = WALLETS.filter((w) => balances.some((b) => b.provider === w) || floats.some((f) => f.provider === w && (Number(f.opening) || Number(f.b2b_in) || Number(f.b2b_out))) || openGapsOf(gaps, deviceId, w).length > 0);
  const alerts = floats.filter((f) => recentB2BOut(f));
  const openCount = WALLETS.reduce((n, w) => n + openGapsOf(gaps, deviceId, w).length, 0);
  const summary = alerts.length
    ? `B2B OUT in the last 24 h on ${alerts.map((f) => PROVIDER_LABEL[f.provider] ?? f.provider).join(", ")}`
    : openCount ? `${openCount} balance move${openCount === 1 ? "" : "s"} with no SMS to explain`
    : shown.length ? `${shown.length} wallet${shown.length === 1 ? "" : "s"}` : "no balance yet";

  async function save(provider: string) {
    const n = parseOpening(text);
    if (n === null) { setProblem("Type an amount from 0 to 10,000,000."); return; }
    setBusy(true);
    setProblem("");
    const { error } = await sb.rpc("set_wallet_b2b_opening", { p_device: deviceId, p_provider: provider, p_amount: n });
    setBusy(false);
    if (error) { setProblem(error.message); return; }
    setEditing(null);
    onChanged();
  }

  async function mark(g: GapRow, kind: string) {
    setBusy(true);
    setProblem("");
    const { error } = await sb.rpc("set_balance_gap", { p_gap: g.id, p_kind: kind });
    setBusy(false);
    if (error) { setProblem(error.message); return; }
    onChanged();
  }

  return (
    <Disclosure icon={Landmark} title="B2B money (distributor float)" summary={summary}>
      <p className="mb-3 text-sm text-muted-foreground">
        Money the distributor puts into an agent wallet (B2B in) is not yours, so jobs start from <span className="font-medium text-foreground">your money</span> = balance minus the B2B float.
        Type the B2B amount in the wallet right now as the opening; from then on every B2B in adds to it and every B2B out takes from it (from the SMS, or from the wallet&apos;s statement when no SMS comes, as on bKash).
        Money that came in with no SMS at all is held back too until the statement or you say what it was.
      </p>
      {loadError ? (
        <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive" role="alert">
          Could not read the saved B2B numbers ({loadError}). What you save is stored, but it cannot be shown until this is fixed, so the figures below are NOT the real ones.
        </p>
      ) : null}
      {shown.length === 0 ? <p className="text-sm text-muted-foreground">No wallet with a balance on this phone yet.</p> : null}
      <div className="space-y-3">
        {shown.map((w) => {
          const f = floats.find((x) => x.provider === w);
          const bal = balances.find((b) => b.provider === w);
          const held = heldBack(f);
          const own = ownMoneyOf(bal?.balance ?? null, f);
          const red = recentB2BOut(f);
          const warn = floatWarning(f);
          const open = openGapsOf(gaps, deviceId, w);
          const pendingIn = Number(f?.pending_in ?? 0);
          return (
            <div key={w} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{PROVIDER_LABEL[w] ?? w}</span>
                <Button size="sm" variant="ghost" onClick={() => openLedgerFor({ device: deviceId, provider: w })}>Open ledger</Button>
              </div>
              <dl className="mt-1 grid grid-cols-3 gap-2">
                <div><dt className="text-xs text-muted-foreground">Balance</dt><dd className="tabular">{bal ? tk(bal.balance) : "–"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Held back (B2B)</dt><dd className="tabular">{tk(held)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Your money</dt><dd className="tabular font-medium">{own == null ? "–" : tk(own)}</dd></div>
              </dl>
              <p className="mt-1 text-xs text-muted-foreground">
                Opening {tk(Number(f?.opening ?? 0))}{f?.opening_at ? ` set ${when(f.opening_at)}` : " (not set)"} · B2B in since {tk(Number(f?.b2b_in ?? 0))} · B2B out since {tk(Number(f?.b2b_out ?? 0))}
                {" · float "}{tk(Math.max(Number(f?.float ?? 0), 0))}
                {pendingIn > 0 ? ` · came in with no SMS, not explained yet ${tk(pendingIn)}` : ""}
              </p>
              {warn ? <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400" role="alert">{warn}</p> : null}
              {red && f ? (
                <p className="mt-1 text-xs font-medium text-destructive" role="alert">
                  B2B OUT {f.last_out_amount != null ? tk(Number(f.last_out_amount)) : ""} {when(f.last_out_at)}: money left this wallet for the distributor.
                </p>
              ) : null}
              {open.length > 0 ? (
                <ul className="mt-2 space-y-2">
                  {open.map((g) => (
                    <li key={g.id} className="rounded-md border border-amber-300/60 bg-amber-50/60 p-2 dark:border-amber-500/30 dark:bg-amber-950/20">
                      <p className="text-xs">{gapLine(g)}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{gapStatus(g)} What was it?</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {gapChoices(g).map((c) => (
                          <Button key={c.kind} size="sm" variant={c.kind === "b2b_in" || c.kind === "b2b_out" ? "default" : "outline"} disabled={busy} onClick={() => void mark(g, c.kind)}>
                            {c.label}
                          </Button>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
              {editing === w ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Input value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" placeholder="B2B amount in the wallet now" className="w-56" aria-label={`Opening B2B amount for ${PROVIDER_LABEL[w] ?? w}`} />
                  <Button size="sm" disabled={busy} onClick={() => void save(w)}>Save opening</Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setEditing(null); setProblem(""); }}>Cancel</Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" className="mt-2" onClick={() => { setEditing(w); setText(f ? String(f.opening) : ""); setProblem(""); }}>Set opening B2B amount</Button>
              )}
            </div>
          );
        })}
      </div>
      {problem ? <p className="mt-2 text-xs text-destructive">{problem}</p> : null}
    </Disclosure>
  );
}
