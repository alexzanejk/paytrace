// Pure helpers for the USDT watcher (no I/O, so they can be unit tested): how to read a BEP20 transfer log and a TRC20 transfer record.

/** Binance-Peg USDT on BNB Smart Chain (18 decimals) and Tether USDT on TRON (6 decimals). Only transfers of these contracts count. */
export const BEP20_USDT = "0x55d398326f99059fF775485246999027B3197955";
export const TRC20_USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
/** keccak256("Transfer(address,address,uint256)") */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
/** A transfer is trusted once this many blocks sit on top of it (about 45 seconds on BNB Smart Chain). */
export const BEP20_CONFIRMATIONS = 15;

/** The receiving address as an event topic: 0x + 24 zeros + the 20 address bytes. */
export function addressTopic(address: string): string {
  return "0x" + "0".repeat(24) + address.replace(/^0x/i, "").toLowerCase();
}

/** 18-decimal integer (as hex or decimal text) -> decimal text, exactly, without floating point. */
export function formatUnits(value: bigint, decimals: number): string {
  const neg = value < 0n;
  const v = neg ? -value : value;
  const s = v.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return (neg ? "-" : "") + whole + (frac ? "." + frac : "");
}

export interface Transfer {
  tx: string;
  logIndex: number;
  from: string;
  to: string;
  amount: string; // decimal text
  block: number | null;
  timeMs: number | null; // block time, if the source gave it
}

interface EvmLog {
  topics?: string[];
  data?: string;
  transactionHash?: string;
  logIndex?: string;
  blockNumber?: string;
  blockTimestamp?: string;
  removed?: boolean;
}

/** One `Transfer` log of the USDT contract. null = not a usable transfer (removed by a reorg, wrong shape). */
export function parseEvmLog(log: EvmLog): Transfer | null {
  if (!log || log.removed) return null;
  const t = log.topics;
  if (!Array.isArray(t) || t.length !== 3 || t[0]?.toLowerCase() !== TRANSFER_TOPIC) return null;
  if (typeof log.data !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(log.data)) return null;
  if (typeof log.transactionHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(log.transactionHash)) return null;
  const addr = (topic: string) => (/^0x0{24}[0-9a-fA-F]{40}$/.test(topic) ? "0x" + topic.slice(26).toLowerCase() : null);
  const from = addr(t[1]);
  const to = addr(t[2]);
  if (!from || !to) return null;
  const hex = (v: string | undefined) => (typeof v === "string" && /^0x[0-9a-fA-F]+$/.test(v) ? Number(BigInt(v)) : null);
  const ts = hex(log.blockTimestamp);
  return {
    tx: log.transactionHash.toLowerCase(),
    logIndex: hex(log.logIndex) ?? 0,
    from, to,
    amount: formatUnits(BigInt(log.data), 18),
    block: hex(log.blockNumber),
    timeMs: ts === null ? null : ts * 1000,
  };
}

interface TronItem {
  transaction_id?: string;
  from?: string;
  to?: string;
  value?: string;
  type?: string;
  block_timestamp?: number;
  token_info?: { address?: string; decimals?: number };
}

/** One TronGrid TRC20 record. null = not USDT, not a plain Transfer, or malformed. */
export function parseTronItem(item: TronItem): Transfer | null {
  if (!item || item.token_info?.address !== TRC20_USDT) return null;
  if (item.type && item.type !== "Transfer") return null;
  if (typeof item.transaction_id !== "string" || !/^[0-9a-fA-F]{64}$/.test(item.transaction_id)) return null;
  if (typeof item.value !== "string" || !/^\d{1,40}$/.test(item.value)) return null;
  if (typeof item.from !== "string" || typeof item.to !== "string") return null;
  if (typeof item.block_timestamp !== "number" || !Number.isFinite(item.block_timestamp)) return null;
  const decimals = typeof item.token_info?.decimals === "number" ? item.token_info.decimals : 6;
  return {
    tx: item.transaction_id.toLowerCase(),
    logIndex: 0,
    from: item.from, to: item.to,
    amount: formatUnits(BigInt(item.value), decimals),
    block: null,
    timeMs: item.block_timestamp,
  };
}

/** Splits a block range in two, for nodes that refuse a range with "limit exceeded". */
export function splitRange(from: number, to: number): [[number, number], [number, number]] | null {
  if (to <= from) return null;
  const mid = from + Math.floor((to - from) / 2);
  return [[from, mid], [mid + 1, to]];
}
