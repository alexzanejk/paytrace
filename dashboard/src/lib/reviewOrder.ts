/** The order a held payment belongs to, when the customer typed its exact TrxID on that order's pay page (owner
 *  2026-11-11: "the system already knows whose order it is"). Only an exact TrxID counts: no guessing by amount or time.
 *  Only orders `manual_match` can still credit: waiting, held, or expired (it accepts up to 48 h after expiry). */
export interface ClaimingOrder {
  id: string;
  order_no: string;
  status: string;
  expected_amount: number | string;
  claimed_trx_id: string | null;
  claimed_provider: string | null;
  created_at?: string;
}

const CREDITABLE = new Set(["pending", "review", "expired"]);

export function typedOrderFor<T extends ClaimingOrder>(p: { trx_id: string; provider: string }, orders: T[]): T | null {
  const trx = p.trx_id.trim().toUpperCase();
  const hits = orders.filter(
    (o) => CREDITABLE.has(o.status) && (o.claimed_trx_id ?? "").trim().toUpperCase() === trx && (!o.claimed_provider || o.claimed_provider === p.provider),
  );
  if (hits.length === 0) return null;
  // Two orders with the same typed TrxID (a customer retried): the newest one, which is the one the website still waits on.
  return [...hits].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0]!;
}

/** "Asked Tk 500, Tk 495 was paid" when the amounts differ, else "". */
export function amountNote(asked: number | string, paid: number | string, money: (n: number) => string): string {
  const a = Number(asked), b = Number(paid);
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) < 0.005) return "";
  return `The order asked for ${money(a)}, ${money(b)} was paid. The website will be told ${money(b)} was paid.`;
}
