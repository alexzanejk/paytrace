export const PROVIDERS = ["bkash", "nagad", "rocket", "upay"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const PROVIDER_LABEL: Record<string, string> = {
  bkash: "bKash",
  nagad: "Nagad",
  rocket: "Rocket",
  upay: "Upay",
};

export const TYPE_LABEL: Record<string, string> = {
  payment_received: "Payment received",
  send_money_received: "Send Money received",
  cash_out: "Agent Cash Out",
  unknown: "Unknown",
};

export interface Payment {
  id: string;
  provider: string;
  txn_type: string;
  trx_id: string;
  amount: number;
  fee: number;
  commission: number;
  balance: number | null;
  counterparty: string | null;
  occurred_at: string | null;
  received_at: string;
  status: string;
  review_reason: string | null;
  raw_message: string;
}

export interface Order {
  id: string;
  order_no: string;
  customer_name: string | null;
  customer_phone: string | null;
  expected_amount: number;
  status: string;
  expires_at: string;
  created_at: string;
  claimed_trx_id: string | null;
  claimed_provider: string | null;
}

export interface Device {
  id: string;
  pair_code: string;
  name: string;
  status: string;
  created_at: string;
  approved_at: string | null;
  last_seen_at: string | null;
}

export interface EventRow {
  id: number;
  at: string;
  kind: string;
  provider: string | null;
  detail: unknown;
}

export interface Totals {
  day: string;
  provider: string;
  txn_type: string;
  n: number;
  amount: number;
  fee: number;
  commission: number;
}

export interface Settings {
  enabled_providers: string[];
  order_expiry_minutes: number;
}
