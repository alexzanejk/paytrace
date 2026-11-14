import { ChevronRight, CircleCheck, TriangleAlert } from "lucide-react";
import { sb } from "@/lib/supabase";
import { addDays, dhakaDay } from "@/lib/period";
import { deviceHealth } from "@/lib/deviceHealth";
import { newestOf, outdatedPhones } from "@/lib/appVersion";
import { latestReleaseBuild } from "@/lib/latestRelease";
import { depositCoverage } from "@/lib/walletNumbers";
import { partnersOwed, type CommissionDayRow } from "@/lib/commissionPays";
import { needs, unchecked, type NeedCounts } from "@/lib/needsYou";
import { openPage } from "@/lib/nav";
import type { Device, DeviceWallet } from "@/lib/types";
import { useQuery } from "@/hooks/useQuery";
import { useNow } from "@/hooks/useNow";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Counted = { count: number | null; error: unknown };
/** A count that could not be read is null (and said so on the page), never a silent zero. */
const countOf = async (q: PromiseLike<Counted>): Promise<number | null> => {
  try {
    const r = await q;
    return r.error ? null : r.count ?? 0;
  } catch {
    return null;
  }
};
const head = (table: string) => sb.from(table).select("id", { count: "exact", head: true });
const WAITING = ["checking", "mismatch", "review"];

async function load(devices: Device[], now: number): Promise<NeedCounts> {
  const approved = devices.filter((d) => d.status === "approved");
  const [held, sends, taka, payoutsUnsure, commissionUnsure, webhooksFailed, cryptoReview, wallets, days, release, fromLink] = await Promise.all([
    countOf(head("payments").eq("status", "review")),
    countOf(head("job_transfers").in("status", WAITING)),
    countOf(head("cashin_jobs").in("status", WAITING)),
    countOf(head("payouts").eq("status", "unsure")),
    countOf(head("commission_pays").eq("status", "unsure")),
    countOf(head("webhook_outbox").not("gave_up_at", "is", null).gte("gave_up_at", new Date(now - 864e5).toISOString())),
    countOf(head("crypto_transfers").eq("status", "review")),
    sb.from("device_wallets").select("id,device_id,provider,wallet_number,method,enabled,wallet_group").then((r) => (r.error ? null : (r.data as unknown as DeviceWallet[])), () => null),
    sb.rpc("commission_days", { p_from: addDays(dhakaDay(), -62) }).then((r) => (r.error ? null : (r.data as CommissionDayRow[])), () => null),
    sb.from("app_release").select("version_code").limit(1).then((r) => (r.error ? null : ((r.data?.[0]?.version_code as number | undefined) ?? 0)), () => null),
    latestReleaseBuild().catch(() => null),
  ]);
  const coverage = wallets ? depositCoverage(wallets, devices.map((d) => ({ id: d.id, name: d.name || d.pair_code, status: d.status }))) : null;
  const owed = days ? partnersOwed(days) : null;
  const newest = release === null && fromLink === null ? null : newestOf(release, fromLink);
  return {
    held,
    jobsWaiting: sends === null || taka === null ? null : sends + taka,
    payoutsUnsure,
    commissionUnsure,
    commissionDue: owed ? { partners: owed.length, amount: Math.round(owed.reduce((s, p) => s + p.due, 0) * 100) / 100 } : null,
    phonesOffline: approved.filter((d) => deviceHealth(d, now).level !== "online").map((d) => d.name || d.pair_code),
    phonesOutdated: newest === null ? null : outdatedPhones(approved.map((d) => ({ name: d.name || d.pair_code, version: d.info?.app_version })), newest).map((p) => p.name),
    // With no phone connected yet there is nothing to hand out; that is a setup step, not an alarm.
    numbersMissing: coverage ? (approved.length ? coverage.missing : []) : null,
    numbersInvalid: coverage ? coverage.invalid.length : null,
    webhooksFailed,
    cryptoReview,
  };
}

/** The top of the Home page: everything waiting for a person, worst first, each one tap from the page that fixes it. */
export function NeedsYou({ devices }: { devices: Device[] }) {
  const now = useNow(15000);
  const key = devices.map((d) => `${d.id}:${d.status}:${d.last_seen_at}:${d.info?.app_version}`).join("|");
  const { data } = useQuery(() => load(devices, Date.now()), [key], { refreshMs: 30000 });

  if (!data) {
    return <Card className="mb-6 p-4 text-sm text-muted-foreground" aria-busy>Checking what needs you…</Card>;
  }
  // Phones go offline between loads; the list follows the clock, not only the last load.
  const live: NeedCounts = {
    ...data,
    phonesOffline: devices.filter((d) => d.status === "approved" && deviceHealth(d, now).level !== "online").map((d) => d.name || d.pair_code),
  };
  const list = needs(live);
  const missed = unchecked(live);

  return (
    <section className="mb-6" aria-label="Needs you">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">Needs you{list.length ? ` (${list.length})` : ""}</h3>
        <span className="text-xs text-muted-foreground">checked every half minute</span>
      </div>
      {list.length === 0 ? (
        <Card className="flex items-center gap-3 p-4 text-sm">
          <CircleCheck className="h-5 w-5 shrink-0 text-status-ok" aria-hidden />
          <span>Nothing needs you right now.</span>
        </Card>
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {list.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => openPage(n.page)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/60 focus-visible:bg-muted/60"
            >
              <span
                className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full", n.tone === "bad" ? "bg-status-bad-bg text-status-bad" : "bg-status-warn-bg text-status-warn")}
                aria-hidden
              >
                <TriangleAlert className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{n.title}</span>
                <span className="block text-xs text-muted-foreground">{n.detail}</span>
              </span>
              <span className="hidden shrink-0 text-sm font-medium text-primary sm:inline">{n.action}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </button>
          ))}
        </Card>
      )}
      {missed.length ? <p className="mt-2 text-xs text-status-warn">Could not check: {missed.join(", ")}. Open that page to see it.</p> : null}
    </section>
  );
}
