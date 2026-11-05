import { useState } from "react";
import { OFFLINE_AFTER_SEC } from "@/lib/deviceHealth";
import { must, sb } from "@/lib/supabase";
import { useQuery } from "@/hooks/useQuery";
import { Screen } from "@/components/Screen";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyRow } from "@/components/Empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  mainNumbers, methodLabel, planLine, providerLabel, sitePlan, isChosen, unchosenCount,
  type MainNumber, type NumberDevice, type NumberWallet, type SiteAssignment,
} from "@/lib/siteNumbers";

interface SiteRow { id: string; name: string }

/** Which deposit numbers each website shows: every number on a main phone down the side, a tick per website.
 *  A website with no tick for a wallet type is given any main number, in turn, as before. */
export function SiteNumbers() {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const { data, error, loading, refresh } = useQuery(
    async () => {
      const [sites, devices, wallets, assignments] = await Promise.all([
        sb.from("api_keys").select("id,name").is("revoked_at", null).order("name"),
        sb.from("devices").select("id,name,status,last_seen_at,default_group"),
        sb.from("device_wallets").select("id,device_id,provider,wallet_number,method,enabled,wallet_group"),
        sb.from("site_wallets").select("api_key_id,wallet_id,enabled"),
      ]);
      return {
        sites: must(sites) as SiteRow[],
        devices: must(devices) as NumberDevice[],
        wallets: must(wallets) as NumberWallet[],
        assignments: must(assignments) as SiteAssignment[],
      };
    },
    [],
    { refreshMs: 30000 },
  );

  const now = Date.now();
  const sites = data?.sites ?? [];
  const numbers: MainNumber[] = data ? mainNumbers(data.wallets, data.devices, now, OFFLINE_AFTER_SEC) : [];
  const assignments = data?.assignments ?? [];
  const partnerPhones = (data?.devices ?? []).filter((d) => d.status === "approved" && (d.default_group ?? "main") !== "main");

  async function toggle(site: SiteRow, n: MainNumber, on: boolean) {
    const key = `${site.id}:${n.id}`;
    setBusy(key);
    setNote("");
    const { error: err } = await sb.rpc("set_site_wallet", { p_key: site.id, p_wallet: n.id, p_on: on });
    setBusy(null);
    if (err) setNote(err.message);
    else setNote(on ? `${site.name} now shows ${n.number} for ${providerLabel(n.provider)} ${methodLabel(n.method)}.` : `${n.number} removed from ${site.name}.`);
    refresh();
  }

  return (
    <Screen loading={loading} error={error} hasData={!!data}>
      <PageHeader
        title="Numbers by site"
        description="Tick the deposit numbers each website may show its customers. Only numbers on your MAIN phones are listed. A website with no tick for a wallet type is given any main number, in turn, as before."
      />

      <Card className="mb-4 p-4 text-sm text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">How a number is picked.</span> When a website creates a deposit, PayTrace looks at the ticked numbers for that wallet type (for example Nagad Cash Out) and gives the customer one of them: a number on an online phone first, then the one handed out longest ago. Partner phones are not here: a partner's players get the partner's own numbers through the code the website sends.
          {partnerPhones.length ? ` Partner phones now: ${partnerPhones.map((d) => `${d.name || "Unnamed"} (${d.default_group})`).join(", ")}.` : ""}
        </p>
      </Card>

      <Card className="overflow-x-auto p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>Phone</TableHead>
              {sites.map((s) => <TableHead key={s.id} className="text-center">{s.name}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {numbers.length === 0 ? (
              <EmptyRow cols={2 + sites.length} text="No numbers on a main phone yet. Add them on the Phones page under Deposit numbers." />
            ) : (
              numbers.map((n) => (
                <TableRow key={n.id}>
                  <TableCell>
                    <div className="font-mono text-sm">{n.number}</div>
                    <div className="text-xs text-muted-foreground">{providerLabel(n.provider)} · {methodLabel(n.method)}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{n.deviceName}</div>
                    <Badge tone={n.online ? "ok" : "bad"}>{n.online ? "Online" : "Offline"}</Badge>
                  </TableCell>
                  {sites.map((s) => {
                    const on = isChosen(assignments, s.id, n.id);
                    const key = `${s.id}:${n.id}`;
                    return (
                      <TableCell key={s.id} className="text-center">
                        <input
                          type="checkbox"
                          className="h-5 w-5 cursor-pointer accent-primary"
                          checked={on}
                          disabled={busy !== null}
                          onChange={(e) => void toggle(s, n, e.target.checked)}
                          aria-label={`${s.name} shows ${n.number} (${providerLabel(n.provider)} ${methodLabel(n.method)})`}
                        />
                        {busy === key ? <span className="block text-[10px] text-muted-foreground">saving…</span> : null}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
      {note ? <p className="mt-2 text-sm text-muted-foreground">{note}</p> : null}

      <h2 className="mb-2 mt-6 text-base font-semibold">What each website shows right now</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {sites.map((s) => {
          const plan = sitePlan(s.id, numbers, assignments);
          const open = unchosenCount(plan);
          return (
            <Card key={s.id} className="p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">{s.name}</h3>
                {plan.length === 0 ? <Badge tone="bad">No numbers at all</Badge> : open ? <Badge tone="warn">{open} not chosen</Badge> : <Badge tone="ok">All chosen</Badge>}
              </div>
              {plan.length === 0 ? (
                <p className="text-sm text-muted-foreground">No main phone has a number yet, so this site's deposits are refused.</p>
              ) : (
                <ul className="grid gap-1 text-sm">
                  {plan.map((e) => (
                    <li key={`${e.provider}|${e.method}`} className={e.fallback ? "text-status-warn" : ""}>{planLine(e)}</li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>
    </Screen>
  );
}
