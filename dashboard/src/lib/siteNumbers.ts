// Which deposit numbers each website shows (migration 057). Pure: the page and the tests both use it.
//
// Only numbers on MAIN phones (wallet group "main", phone approved, number switched on) are candidates for a site's
// ordinary deposits. A partner phone's numbers (group = the partner's code) are never here: a partner's players reach
// them by the code the website sends. A site with no chosen number for a wallet type gets any main number, in turn,
// exactly as before, so the owner can switch over one site at a time.

/** Same figure as OFFLINE_AFTER_SEC in deviceHealth.ts (the page passes that one in; this is only the default, kept
 *  here so this file has no runtime imports and the tests can load it). */
export const DEFAULT_OFFLINE_AFTER_SEC = 90;

export interface NumberDevice {
  id: string;
  name: string;
  status: string;
  last_seen_at: string | null;
  default_group?: string | null;
}

export interface NumberWallet {
  id: string;
  device_id: string;
  provider: string;
  wallet_number: string;
  method: "send_money" | "cash_out" | string;
  enabled: boolean;
  wallet_group: string | null;
}

export interface SiteAssignment {
  api_key_id: string;
  wallet_id: string;
  enabled: boolean;
}

export interface MainNumber {
  id: string;
  deviceId: string;
  deviceName: string;
  provider: string;
  method: string;
  number: string;
  online: boolean;
}

const PROVIDER_ORDER = ["bkash", "nagad", "rocket", "upay"];
const PROVIDER_NAME: Record<string, string> = { bkash: "bKash", nagad: "Nagad", rocket: "Rocket", upay: "Upay" };

export const methodLabel = (m: string): string => (m === "cash_out" ? "Cash Out (agent)" : m === "send_money" ? "Send Money" : m);
export const providerLabel = (p: string): string => PROVIDER_NAME[p] ?? p;

export function isOnline(lastSeen: string | null | undefined, now: number, offlineAfterSec = DEFAULT_OFFLINE_AFTER_SEC): boolean {
  if (!lastSeen) return false;
  const t = new Date(lastSeen).getTime();
  return Number.isFinite(t) && now - t < offlineAfterSec * 1000;
}

/** Every number a site could be given: main group, approved phone, switched on. Sorted by wallet, method, phone. */
export function mainNumbers(wallets: NumberWallet[], devices: NumberDevice[], now: number, offlineAfterSec = DEFAULT_OFFLINE_AFTER_SEC): MainNumber[] {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const out: MainNumber[] = [];
  for (const w of wallets) {
    const d = byId.get(w.device_id);
    if (!d || d.status !== "approved" || !w.enabled || (w.wallet_group ?? "main") !== "main") continue;
    out.push({ id: w.id, deviceId: d.id, deviceName: d.name || "Unnamed phone", provider: w.provider, method: w.method, number: w.wallet_number, online: isOnline(d.last_seen_at, now, offlineAfterSec) });
  }
  const rank = (p: string) => { const i = PROVIDER_ORDER.indexOf(p); return i < 0 ? 99 : i; };
  return out.sort((a, b) => rank(a.provider) - rank(b.provider) || a.method.localeCompare(b.method) || a.deviceName.localeCompare(b.deviceName) || a.number.localeCompare(b.number));
}

export function isChosen(assignments: SiteAssignment[], keyId: string, walletId: string): boolean {
  return assignments.some((a) => a.api_key_id === keyId && a.wallet_id === walletId && a.enabled);
}

export interface PlanEntry {
  provider: string;
  method: string;
  /** The numbers this site will be given for this wallet type, in rotation. */
  numbers: MainNumber[];
  /** true = the site chose nothing for this wallet type, so any main number may show. */
  fallback: boolean;
}

/** For one site: what each wallet type will show. One entry per wallet type that has at least one main number. */
export function sitePlan(keyId: string, numbers: MainNumber[], assignments: SiteAssignment[]): PlanEntry[] {
  const kinds = new Map<string, MainNumber[]>();
  for (const n of numbers) {
    const k = `${n.provider}|${n.method}`;
    const list = kinds.get(k);
    if (list) list.push(n);
    else kinds.set(k, [n]);
  }
  const out: PlanEntry[] = [];
  for (const [, all] of kinds) {
    const chosen = all.filter((n) => isChosen(assignments, keyId, n.id));
    out.push({ provider: all[0].provider, method: all[0].method, numbers: chosen.length ? chosen : all, fallback: chosen.length === 0 });
  }
  return out;
}

/** "bKash · Cash Out (agent): 01711111111, 01722222222 (in turn)" or "...: not chosen, any main number may show". */
export function planLine(e: PlanEntry): string {
  const head = `${providerLabel(e.provider)} · ${methodLabel(e.method)}`;
  if (e.fallback) return `${head}: not chosen, any main number may show (${e.numbers.map((n) => n.number).join(", ")})`;
  return `${head}: ${e.numbers.map((n) => n.number).join(", ")}${e.numbers.length > 1 ? " (in turn)" : ""}`;
}

/** How many wallet types a site has left unchosen. */
export const unchosenCount = (plan: PlanEntry[]): number => plan.filter((e) => e.fallback).length;
