/** Personal bKash balance by USSD (owner's recording 2026-11-17). The phone checks every personal bKash account saved in
 *  its app and answers one line per account; this reads those lines. The shape must match PersonalBalanceReport in the
 *  Android app (PersonalBalance.kt): "account 1 01700000000 SIM 2: Tk 17205.08" or "account 2 01800000000 SIM 1: failed no_pin".
 *  Pure, tested in tests/personalBalance.test.ts. */

export const PERSONAL_BALANCE_KIND = "pbalance";

export interface PersonalBalanceRow {
  account: number;
  number: string;
  sim: number;
  balance: number | null;
  error: string | null;
}

const LINE = /^account\s+(\d)\s+(01\d{9})\s+SIM\s+(\d):\s+(?:Tk\s+([\d.]+)|failed\s+([a-z_]+))\s*$/;

export function readPersonalBalances(screens: string[] | null | undefined): PersonalBalanceRow[] {
  const out: PersonalBalanceRow[] = [];
  for (const screen of screens ?? []) {
    for (const raw of String(screen).split("\n")) {
      const m = raw.trim().match(LINE);
      if (!m) continue;
      const balance = m[4] !== undefined ? Number(m[4]) : null;
      out.push({ account: Number(m[1]), number: m[2], sim: Number(m[3]), balance: Number.isFinite(balance) ? balance : null, error: m[5] ?? null });
    }
  }
  return out;
}

/** Does this phone have a personal bKash account the check can read? From the heartbeat's wallet list. */
export function hasPersonalBkash(wallets: Array<{ provider: string; kind?: string }> | null | undefined): boolean {
  return (wallets ?? []).some((w) => w.provider === "bkash" && w.kind === "personal");
}
