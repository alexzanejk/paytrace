// Result messages PayTrace sends to a website (the "webhook outbox"), summed up per website so the owner can see a site
// that is rejecting them and press Retry. Before this (audit 2026-11-04) a site could reject messages for days and nobody knew.

export interface OutboxRow {
  id: number;
  order_id: string;
  event: string;
  created_at: string;
  attempts: number;
  delivered_at: string | null;
  gave_up_at: string | null;
  last_status: string | null;
  next_attempt_at: string | null;
  orders: { api_key_id: string; merchant_order_id: string | null; order_no: string | null } | null;
}

export type OutboxState = "delivered" | "waiting" | "retrying" | "gave_up";

export function outboxState(r: Pick<OutboxRow, "delivered_at" | "gave_up_at" | "attempts">): OutboxState {
  if (r.delivered_at) return "delivered";
  if (r.gave_up_at) return "gave_up";
  return (Number(r.attempts) || 0) > 0 ? "retrying" : "waiting";
}

/** The site's last answer, in plain words. Mirrors answerText in supabase/functions/gateway/notify.ts. */
export function answerText(status: string | null | undefined): string {
  const s = String(status ?? "").trim();
  if (!s) return "not sent yet";
  if (s === "timeout") return "no answer within 8 seconds";
  if (s === "unreachable") return "could not connect";
  const n = Number(s);
  if (n >= 200 && n < 300) return `HTTP ${n}, accepted`;
  if (n === 400) return "HTTP 400, the site rejected the message as bad request";
  if (n === 401 || n === 403) return `HTTP ${n}, the site refused it (wrong secret or blocked)`;
  if (n === 404) return "HTTP 404, the address does not exist";
  if (n === 405) return "HTTP 405, the address does not accept POST";
  if (n >= 500) return `HTTP ${n}, the site's own error`;
  return `HTTP ${s}`;
}

const EVENT: Record<string, string> = { "deposit.paid": "Paid", "deposit.review": "Held", "deposit.expired": "Expired", "deposit.cancelled": "Cancelled" };
export const eventLabel = (event: string): string => EVENT[event] ?? event;

export const orderRef = (r: Pick<OutboxRow, "orders" | "order_id">): string =>
  r.orders?.merchant_order_id || r.orders?.order_no || r.order_id.slice(0, 8);

export interface SiteWebhookSummary {
  total: number;
  delivered: number;
  waiting: number;
  retrying: number;
  gaveUp: number;
  /** Undelivered rows and rows that needed more than one try, newest first. */
  problems: OutboxRow[];
}

/** One website's rows (by its key id) summed up. */
export function summarizeSite(rows: OutboxRow[], keyId: string): SiteWebhookSummary {
  const mine = rows.filter((r) => r.orders?.api_key_id === keyId);
  const s: SiteWebhookSummary = { total: mine.length, delivered: 0, waiting: 0, retrying: 0, gaveUp: 0, problems: [] };
  for (const r of mine) {
    const st = outboxState(r);
    if (st === "delivered") s.delivered++;
    else if (st === "waiting") s.waiting++;
    else if (st === "retrying") s.retrying++;
    else s.gaveUp++;
    if (st !== "delivered") s.problems.push(r);
  }
  s.problems.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return s;
}

export const siteNeedsAttention = (s: SiteWebhookSummary): boolean => s.gaveUp > 0 || s.retrying > 0;

/** "Last 7 days: 46 delivered, 9 given up, 2 still trying" or null when nothing was sent. */
export function summaryLine(s: SiteWebhookSummary): string | null {
  if (!s.total) return null;
  const parts = [`${s.delivered} delivered`];
  if (s.gaveUp) parts.push(`${s.gaveUp} given up`);
  if (s.retrying) parts.push(`${s.retrying} still trying`);
  if (s.waiting) parts.push(`${s.waiting} waiting`);
  return `Last 7 days: ${parts.join(", ")}`;
}
