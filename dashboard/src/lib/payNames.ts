// The NAME on a received transaction, for the Payout page (owner 2026-11-20): who the money is paid to. Written by the
// Telegram bot when a post matched (the person's Telegram @username) or typed by the owner, who
// always wins. Pure; the reads and the RPC live in the pages. Tested in tests/payNames.test.ts.

export interface PaymentName {
  payment_id: string;
  name: string | null;      // null = cleared / nothing yet
  source: "telegram" | "owner";
  tg_user_id?: number | null;
}

/** What a typed name becomes before it is sent: trimmed, at most 64 characters; "" means clear. */
export function cleanName(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 64);
}

/** The short origin shown beside a name. */
export function nameSource(n: PaymentName | undefined): string {
  if (!n || !n.name) return "";
  return n.source === "owner" ? "set by you" : "from Telegram";
}

/** The names of a list of transactions as a map; rows without a name are left out. */
export function namesById(rows: PaymentName[]): Map<string, PaymentName> {
  const m = new Map<string, PaymentName>();
  for (const r of rows) if (r.name) m.set(r.payment_id, r);
  return m;
}

/** One line for a payout's ticked list: "t9ceff6182" or "" when nobody is named. */
export function nameOf(names: Map<string, PaymentName>, paymentId: string): string {
  return names.get(paymentId)?.name ?? "";
}

/** The distinct names among the ticked transactions, so a mixed payout is called out before sending. */
export function namesAmong(names: Map<string, PaymentName>, ids: string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const n = nameOf(names, id);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/** What the search box may carry to the server for a name: letters, digits, _ . @ - and spaces, at most 40 characters. */
export function safeNameTerm(q: string): string {
  return q.replace(/[^A-Za-z0-9_.@\- ]/g, "").trim().slice(0, 40);
}
