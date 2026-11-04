// Telegram message for a payment held for review when the hold happened on the customer's TrxID entry (claim path).
// Before this, only holds seen by the ingest function were messaged; a hold made here was silent (audit 2026-11-04).
// Own copy of the pieces of ingest/notify.ts this function needs: the two functions deploy separately. Plain text only,
// never throws, never logs the token.

export interface Notifier {
  enabled: boolean;
  send(text: string): Promise<boolean>;
}

export function makeNotifier(cfg: { token?: string; chatId?: string }, fetchImpl: typeof fetch = fetch): Notifier {
  const token = (cfg.token ?? "").trim();
  const chatId = (cfg.chatId ?? "").trim();
  const enabled = token.length > 0 && chatId.length > 0;
  return {
    enabled,
    async send(text: string): Promise<boolean> {
      if (!enabled) return false;
      try {
        const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 3500), disable_web_page_preview: true }),
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) console.error("telegram rejected the message, status", res.status);
        return res.ok;
      } catch {
        console.error("telegram request failed"); // not the error itself: its text can carry the token
        return false;
      }
    },
  };
}

const PROVIDER: Record<string, string> = { bkash: "bKash", nagad: "Nagad", rocket: "Rocket", upay: "Upay" };

export function clean(s: unknown, max = 60): string {
  return String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

const taka = (n: number) => "Tk " + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Mirrors ingest/notify.ts and dashboard/src/lib/reasons.ts.
const REASONS: [string, string][] = [
  ["amount_mismatch", "the amount does not match the order"],
  ["phone_mismatch", "it was paid from a different phone number"],
  ["order_expired_before_payment", "the order had already expired"],
  ["paid_before_order", "it was paid before the order was created, so it may be an older receipt"],
  ["wrong_phone", "it arrived on a different phone than the number the customer was shown"],
  ["unsupported_type", "this kind of message cannot credit an order"],
  ["unrecognized_type", "could not tell what kind of payment this is"],
  ["unverified_format", "the message format is not confirmed yet"],
  ["balance_chain_mismatch", "the account balance does not follow the previous message, so it could be a fake SMS"],
  ["cash_in_received", "money came in by Cash In from an agent; a customer may have paid at an agent counter"],
];

export function reasonText(reason: string | null | undefined): string {
  if (!reason) return "it needs a person to decide";
  const hit = REASONS.find(([key]) => reason.startsWith(key));
  return hit ? hit[1] : clean(reason, 80);
}

/** A website's result address keeps failing: sent at the 3rd failed try (about 20 minutes of trying) and when PayTrace
 *  gives up (8 tries, about a day), at most once an hour per website. Before this the failures were silent (audit 2026-11-04). */
export function webhookFailingMessage(p: { site: string; event: string; orderRef: string; attempts: number; status: string; gaveUp: boolean; dashboardUrl: string }): string {
  const what = p.event.replace(/^deposit\./, "");
  return [
    p.gaveUp ? "⚠️ A website is not receiving its result messages (PayTrace has stopped trying)" : "⚠️ A website is rejecting its result messages",
    `${clean(p.site, 40)}: the "${clean(what, 20)}" message for order ${clean(p.orderRef, 40)} failed ${p.attempts} time${p.attempts === 1 ? "" : "s"} (last answer: ${answerText(p.status)}).`,
    p.gaveUp ? "The site was never told this order's result. Press Retry on the Websites page once its developer has fixed the address." : "PayTrace keeps trying for about a day. The site's developer should check the result address.",
    `${p.dashboardUrl}/#/WEBSITES_TAB`,
  ].join("\n").replace("WEBSITES_TAB", "api");
}

/** The site's answer in plain words. */
export function answerText(status: string): string {
  const s = clean(status, 20);
  if (s === "timeout") return "no answer within 8 seconds";
  if (s === "unreachable") return "could not connect";
  const n = Number(s);
  if (n === 400) return "HTTP 400, the site rejected the message as bad request";
  if (n === 401 || n === 403) return `HTTP ${n}, the site refused it (wrong secret or blocked)`;
  if (n === 404) return "HTTP 404, the address does not exist";
  if (n === 405) return "HTTP 405, the address does not accept POST";
  if (n >= 500) return `HTTP ${n}, the site's own error`;
  return `HTTP ${s}`;
}

/** The customer typed a TrxID whose payment is held (or became held by the typing): same wording as the ingest alert. */
export function heldClaimMessage(p: { provider: string; amount: number; trxId: string; reason: string | null; dashboardUrl: string }): string {
  return [
    "⚠️ Payment held for review",
    `${PROVIDER[p.provider] ?? clean(p.provider, 20)} ${taka(p.amount)}  ·  TrxID ${clean(p.trxId, 30)}`,
    `Why: ${reasonText(p.reason)}.`,
    "The customer typed this TrxID on the pay page. It has NOT been credited to any order.",
    `${p.dashboardUrl}/#/review`,
  ].join("\n");
}
