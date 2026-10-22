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
}

export type SubmitState = "paid" | "checking" | "review" | "used" | "expired" | "too_many" | "wrong_method" | "invalid" | "closed";

export class Gone extends Error {}

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
  const { status, data } = await call<OrderView>("pay-order", { tracking_number: tracking });
  if (status === 404) throw new Gone();
  if (status !== 200) throw new Error("server");
  return data;
}

/** Returns the updated order, or the reason the choice was refused. */
export async function pickProvider(tracking: string, provider: string): Promise<OrderView | { error: string }> {
  const { status, data } = await call<OrderView & { error?: string }>("pay-pick", { tracking_number: tracking, provider });
  if (status === 404) throw new Gone();
  if (status === 200) return data;
  if (status === 409 && data.error) return { error: data.error };
  throw new Error("server");
}

export async function submitTrx(tracking: string, trx: string): Promise<SubmitState> {
  const { status, data } = await call<{ state?: SubmitState }>("pay-submit", { tracking_number: tracking, transaction_id: trx });
  if (status === 404) throw new Gone();
  if (status === 400 && data.state) return data.state;
  if (status !== 200 || !data.state) throw new Error("server");
  return data.state;
}
