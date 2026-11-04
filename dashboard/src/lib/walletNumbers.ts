// Deposit numbers vs the numbers the phone app itself reported (owner 2026-11-04: "we now save the number in the app;
// show each phone's saved bKash / Nagad / Rocket number so we just pick it for the deposit number"). Pure, tested.

import type { DeviceWallet } from "./types";

/** One wallet number the phone reported in its heartbeat (saved in the app's Settings, SIM found or chosen). */
export interface ReportedWallet {
  provider: string;
  number: string;
  slot: number;
  found: boolean;
}

/** "+880 17 1234-5678", "8801712345678", "01712345678" -> "01712345678"; anything that is not an 11-digit 01 number -> null.
 *  The same rule as the database (migration 050) and the phone app (PhoneNumbers.normalize). */
export function normalizeBdNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (/^8801[0-9]{9}$/.test(d)) d = "0" + d.slice(3);
  return /^01[0-9]{9}$/.test(d) ? d : null;
}

export const isBdNumber = (n: string | null | undefined): boolean => normalizeBdNumber(n) !== null;

export type SuggestionState = "missing" | "matches" | "differs";

export interface WalletSuggestion {
  provider: string;
  /** The number the phone reported. */
  number: string;
  state: SuggestionState;
  /** The deposit number saved on the dashboard for that wallet, when there is one. */
  saved: DeviceWallet | null;
}

/** For each wallet number the phone reported: not on the dashboard yet, the same as the dashboard, or different. Only
 *  valid 11-digit numbers are offered; a provider the phone reported twice keeps the first. */
export function walletSuggestions(reported: ReportedWallet[] | null | undefined, saved: DeviceWallet[]): WalletSuggestion[] {
  const out: WalletSuggestion[] = [];
  const seen = new Set<string>();
  for (const r of reported ?? []) {
    const n = normalizeBdNumber(r.number);
    if (!n || seen.has(r.provider)) continue;
    seen.add(r.provider);
    const s = saved.find((w) => w.provider === r.provider) ?? null;
    out.push({ provider: r.provider, number: n, state: !s ? "missing" : s.wallet_number === n ? "matches" : "differs", saved: s });
  }
  return out;
}

/** The three wallets customers pay with through a phone. Upay has never had a number. */
export const COVERED_PROVIDERS = ["bkash", "nagad", "rocket"] as const;

export interface Coverage {
  /** Wallets no approved phone has a live, valid deposit number for: a website asking for one gets no number. */
  missing: string[];
  /** Live deposit numbers that are not valid 11-digit numbers: customers are shown them and cannot pay. */
  invalid: { phone: string; provider: string; number: string }[];
}

/** What the pay page can and cannot hand out right now, from the approved phones' deposit numbers. */
export function depositCoverage(wallets: DeviceWallet[], phones: { id: string; name: string; status: string }[]): Coverage {
  const approved = new Map(phones.filter((p) => p.status === "approved").map((p) => [p.id, p.name || "Unnamed phone"]));
  const live = wallets.filter((w) => w.enabled && approved.has(w.device_id));
  const invalid = live.filter((w) => !isBdNumber(w.wallet_number)).map((w) => ({ phone: approved.get(w.device_id)!, provider: w.provider, number: w.wallet_number }));
  const missing = COVERED_PROVIDERS.filter((p) => !live.some((w) => w.provider === p && isBdNumber(w.wallet_number)));
  return { missing: [...missing], invalid };
}

/** One row of the view wallet_order_stats: deposit orders this phone's wallet was shown for in the last 24 hours. */
export interface WalletOrderStat {
  device_id: string | null;
  provider: string;
  wallet_method: string | null;
  wallet_number: string | null;
  orders_24h: number;
  typed_24h: number;
  paid_24h: number;
  held_24h: number;
}

export interface WalletStatLine {
  text: string;
  /** warn = something is probably wrong with this number; info = nothing to act on. */
  tone: "warn" | "info";
}

/** The last 24 hours of one deposit number, in a sentence. The warning rule: customers typed a TrxID at least 3 times and
 *  not one payment arrived, which is what a wrong number (or a dead phone) looks like. Many orders with nothing typed is
 *  normal (people start a deposit and give up) and is only reported. */
export function walletStatLine(stat: WalletOrderStat | null | undefined): WalletStatLine | null {
  if (!stat || stat.orders_24h <= 0) return null;
  const base = `Last 24 h: ${stat.orders_24h} order${stat.orders_24h === 1 ? "" : "s"} shown this number, ${stat.typed_24h} typed a TrxID, ${stat.paid_24h} paid` + (stat.held_24h ? `, ${stat.held_24h} held` : "");
  if (stat.typed_24h >= 3 && stat.paid_24h === 0 && stat.held_24h === 0) {
    return { text: `${base}. Customers say they paid but nothing arrived: check this number and that the phone is on.`, tone: "warn" };
  }
  return { text: base, tone: "info" };
}

/** The stat row for one saved deposit number (matched on phone, provider and method; the number itself may have changed). */
export function statFor(stats: WalletOrderStat[] | null | undefined, w: DeviceWallet): WalletOrderStat | null {
  return (stats ?? []).find((s) => s.device_id === w.device_id && s.provider === w.provider && (s.wallet_method ?? null) === w.method && (s.wallet_number === null || s.wallet_number === w.wallet_number))
    ?? (stats ?? []).find((s) => s.device_id === w.device_id && s.provider === w.provider && (s.wallet_method ?? null) === w.method) ?? null;
}
