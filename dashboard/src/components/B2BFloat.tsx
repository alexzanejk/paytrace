import { useState } from "react";
import { Landmark } from "lucide-react";
import { sb } from "@/lib/supabase";
import { tk, when } from "@/lib/format";
import { PROVIDER_LABEL } from "@/lib/types";
import type { DeviceBalance } from "@/lib/types";
import { ownMoney, parseOpening, recentB2BOut, type B2BFloatRow } from "@/lib/ledger";
import { openLedgerFor } from "@/lib/ledgerNav";
import { Disclosure } from "@/components/Disclosure";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const WALLETS = ["bkash", "nagad", "rocket"] as const;

/** The B2B float of each wallet on this phone (owner 2026-11-05): distributor money the owner does not count as theirs.
 *  Float = the opening amount typed here + B2B in - B2B out since then (from the ledger, so a statement-only line counts).
 *  Jobs start from "your money" = balance - float. A B2B OUT in the last 24 hours is shown in red. */
export function B2BFloat({ deviceId, floats, loadError = "", balances, onChanged }: {
  deviceId: string; floats: B2BFloatRow[]; loadError?: string; balances: DeviceBalance[]; onChanged: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  const shown = WALLETS.filter((w) => balances.some((b) => b.provider === w) || floats.some((f) => f.provider === w && (Number(f.opening) || Number(f.b2b_in) || Number(f.b2b_out))));
  const alerts = floats.filter((f) => recentB2BOut(f));
  const summary = alerts.length ? `B2B OUT in the last 24 h on ${alerts.map((f) => PROVIDER_LABEL[f.provider] ?? f.provider).join(", ")}` : shown.length ? `${shown.length} wallet${shown.length === 1 ? "" : "s"}` : "no balance yet";

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

  return (
    <Disclosure icon={Landmark} title="B2B money (distributor float)" summary={summary}>
      <p className="mb-3 text-sm text-muted-foreground">
        Money the distributor puts into an agent wallet (B2B in) is not yours, so jobs start from <span className="font-medium text-foreground">your money</span> = balance minus the B2B float.
        Type the B2B amount in the wallet right now as the opening; from then on every B2B in adds to it and every B2B out takes from it (from the SMS, or from the wallet&apos;s statement when no SMS comes, as on bKash).
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
          const own = ownMoney(bal?.balance ?? null, f?.float ?? 0);
          const red = recentB2BOut(f);
          return (
            <div key={w} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{PROVIDER_LABEL[w] ?? w}</span>
                <Button size="sm" variant="ghost" onClick={() => openLedgerFor({ device: deviceId, provider: w })}>Open ledger</Button>
              </div>
              <dl className="mt-1 grid grid-cols-3 gap-2">
                <div><dt className="text-xs text-muted-foreground">Balance</dt><dd className="tabular">{bal ? tk(bal.balance) : "–"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">B2B float</dt><dd className="tabular">{tk(Number(f?.float ?? 0))}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Your money</dt><dd className="tabular font-medium">{own == null ? "–" : tk(own)}</dd></div>
              </dl>
              <p className="mt-1 text-xs text-muted-foreground">
                Opening {tk(Number(f?.opening ?? 0))}{f?.opening_at ? ` set ${when(f.opening_at)}` : " (not set)"} · B2B in since {tk(Number(f?.b2b_in ?? 0))} · B2B out since {tk(Number(f?.b2b_out ?? 0))}
              </p>
              {red && f ? (
                <p className="mt-1 text-xs font-medium text-destructive" role="alert">
                  B2B OUT {f.last_out_amount != null ? tk(Number(f.last_out_amount)) : ""} {when(f.last_out_at)}: money left this wallet for the distributor.
                </p>
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
