import { SUPABASE_URL } from "@/lib/config";

const BASE = `${SUPABASE_URL}/functions/v1/gateway`;

export interface OrderView {
  status: "pending" | "paid" | "review" | "expired" | "cancelled";
  amount: number;
  currency: string;
  shop: string | null;
  provider: string | null;
  wallet_number: string | null;
  method: "send_money" | "cash_out" | null;
  seconds_left: number;
  trx_id: string | null;
  providers: string[];
  return_url: string | null;
  result_style?: number;
}

export type SubmitState = "paid" | "checking" | "review" | "used" | "expired" | "too_many" | "wrong_method" | "invalid" | "closed";

export class Gone extends Error {}

/** `/pay/?demo=1` shows the whole customer page with pretend data and talks to no server, so the owner can look at it
 *  (and try it: pick a wallet, enter any TrxID) before connecting a website. Nothing real is created or paid. */
export const DEMO =
  new URLSearchParams(window.location.search).get("demo") === "1" || (window as unknown as { __PAYTRACE_DEMO__?: boolean }).__PAYTRACE_DEMO__ === true;

const demo = {
  style: Number(new URLSearchParams(window.location.search).get("style") || 0) || 0,
  outcome: "paid" as "paid" | "review" | "expired",
  provider: (new URLSearchParams(window.location.search).get("provider") || "bkash") as string | null,
  method: (new URLSearchParams(window.location.search).get("method") || "") as string,
  trx: null as string | null,
  paidAt: 0,
  endsAt: Date.now() + 15 * 60_000,
  tries: 0,
};
const DEMO_WALLET: Record<string, { n: string; m: "send_money" | "cash_out" }> = {
  bkash: { n: "01700000001", m: "cash_out" },
  nagad: { n: "01700000002", m: "send_money" },
  rocket: { n: "01700000003", m: "send_money" },
  upay: { n: "01700000004", m: "send_money" },
};
/** Preview only: switch the pretend order to another provider and start it again. */
export function demoSwitch(provider: string, method: string) {
  demo.provider = provider;
  demo.method = method;
  demo.trx = null;
  demo.paidAt = 0;
  demo.endsAt = Date.now() + 15 * 60_000;
}
export function demoStyle(n: number) {
  demo.style = n;
}
function demoView(): OrderView {
  const w0 = demo.provider ? DEMO_WALLET[demo.provider] : null;
  const m = (demo.method === "send_money" || demo.method === "cash_out" ? demo.method : w0?.m) ?? null;
  const w = w0 ? { n: w0.n.slice(0, -1) + (m === "cash_out" ? "1" : "2"), m } : null;
  const done = demo.paidAt > 0 && Date.now() >= demo.paidAt;
  const paid = done && demo.outcome === "paid";
  return {
    status: paid ? "paid" : done && demo.outcome !== "paid" ? demo.outcome : Date.now() > demo.endsAt ? "expired" : "pending",
    result_style: demo.style,
    amount: Number(new URLSearchParams(window.location.search).get("amount")) || 500,
    currency: "BDT",
    shop: "Your shop (preview)",
    provider: demo.provider,
    wallet_number: w?.n ?? null,
    method: w?.m ?? null,
    seconds_left: Math.max(0, Math.floor((demo.endsAt - Date.now()) / 1000)),
    trx_id: demo.trx,
    providers: [],
    return_url: null,
  };
}

async function call<T>(route: string, body: Record<string, unknown>): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE}/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let data = {} as T;
  try {
    data = (await res.json()) as T;
  } catch {
    /* an empty or non-JSON answer is handled by the caller through the status */
  }
  return { status: res.status, data };
}

export async function getOrder(tracking: string): Promise<OrderView> {
  if (DEMO) return demoView();
  const { status, data } = await call<OrderView>("pay-order", { tracking_number: tracking });
  if (status === 404) throw new Gone();
  if (status !== 200) throw new Error("server");
  return data;
}

/** Returns the updated order, or the reason the choice was refused. */
export async function pickProvider(tracking: string, provider: string): Promise<OrderView | { error: string }> {
  if (DEMO) {
    if (!DEMO_WALLET[provider]) return { error: "no_wallet" };
    demo.provider = provider;
    return demoView();
  }
  const { status, data } = await call<OrderView & { error?: string }>("pay-pick", { tracking_number: tracking, provider });
  if (status === 404) throw new Gone();
  if (status === 200) return data;
  if (status === 409 && data.error) return { error: data.error };
  throw new Error("server");
}

export async function submitTrx(tracking: string, trx: string): Promise<SubmitState> {
  if (DEMO) {
    const t = trx.replace(/\s+/g, "").toUpperCase();
    if (!/^[A-Z0-9]{6,40}$/.test(t)) return "invalid";
    if (t === "USEDTRX1") return "used"; // try this one to see the "already used" message
    if (t === "FORMATBAD1") return "invalid"; // and this one for the red error message
    demo.trx = t;
    demo.outcome = t === "REVIEW001" ? "review" : t === "EXPIRED01" ? "expired" : "paid";
    demo.paidAt = Date.now() + 6000; // pretend the SMS arrives and the payment is confirmed 6 seconds later
    return "checking";
  }
  const { status, data } = await call<{ state?: SubmitState }>("pay-submit", { tracking_number: tracking, transaction_id: trx });
  if (status === 404) throw new Gone();
  if (status === 400 && data.state) return data.state;
  if (status !== 200 || !data.state) throw new Error("server");
  return data.state;
}
