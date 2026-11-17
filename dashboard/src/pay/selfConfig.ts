/** Self-hosted copy of this page (owner 2026-11-17: a website hosts the page itself, "same UI and design"). The website's
 *  server writes its own two addresses and the order into the page (`<script type="application/json" id="pay-config">`);
 *  the page then talks ONLY to that server, which calls the gateway with its key (routes order-view and submit-trx). The
 *  key never reaches the page. Absent (PayTrace's own /pay/ page, or the preview): null. Pure, tested in tests/selfPay.test.ts. */
export interface SelfConfig {
  orderId: string;
  viewUrl: string;
  submitUrl: string;
}

export function readSelfConfig(text: string | null | undefined): SelfConfig | null {
  if (!text || !text.trim().startsWith("{")) return null;
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).trim() : "");
    const orderId = str(o.order_id), viewUrl = str(o.view_url), submitUrl = str(o.submit_url);
    if (!orderId || orderId.length > 100 || !viewUrl || !submitUrl) return null;
    return { orderId, viewUrl, submitUrl };
  } catch {
    return null;
  }
}

