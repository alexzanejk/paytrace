import type { DeviceInfo } from "@/lib/deviceHealth";

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
  balance_delta: number | null;
  chain_status: string | null;
  device_id: string | null;
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
  kind: "manual" | "deposit";
  merchant_order_id: string | null;
  provider: string | null;
  wallet_number: string | null;
  wallet_method: "send_money" | "cash_out" | null;
  api_key_id: string | null;
}

/** The number a phone receives one provider's payments on, shown to customers on the pay page. */
export interface DeviceWallet {
  id: string;
  device_id: string;
  provider: string;
  wallet_number: string;
  method: "send_money" | "cash_out";
  enabled: boolean;
  wallet_group: string;
}

export interface WalletGroup {
  name: string;
  enabled: boolean;
}

export interface Device {
  id: string;
  pair_code: string;
  name: string;
  status: string;
  created_at: string;
  approved_at: string | null;
  last_seen_at: string | null;
  info: DeviceInfo | null;
  /** The Earnings card in this phone's own app (partner commission). */
  show_earnings?: boolean;
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

export interface DeviceBalance {
  device_id: string;
  provider: string;
  balance: number;
  at: string;
}

export interface ProviderBalance {
  provider: string;
  device_id: string | null;
  balance: number;
  at: string;
}
