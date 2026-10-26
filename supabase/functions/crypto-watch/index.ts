// PayTrace crypto watcher: once a minute (pg_cron) it looks for new USDT transfers INTO the owner's receiving addresses on BNB Smart Chain (BEP20)
// and TRON (TRC20) and hands each one to the database (`crypto_ingest`), which pays the open order whose exact amount arrived.
// No auth needed: it takes no input, returns nothing, and everything it writes is idempotent (a transfer is stored once).
// Optional secrets (set by the owner in Supabase, never in code): TRONGRID_API_KEY (free; raises TronGrid's limits) and BSC_RPC_URL
// (your own node address, tried first). Without them the free public servers are used.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  addressTopic, BEP20_CONFIRMATIONS, BEP20_USDT, parseEvmLog, parseTronItem, splitRange, TRANSFER_TOPIC, TRC20_USDT, type Transfer,
} from "./logic.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const TRONGRID_KEY = Deno.env.get("TRONGRID_API_KEY") ?? "";
const BSC_NODES = [Deno.env.get("BSC_RPC_URL") ?? "", "https://bsc-rpc.publicnode.com", "https://bsc-dataseed.binance.org"].filter((u) => /^https:\/\//.test(u));
const MAX_RANGE = 500; // blocks per look (about 25 minutes of chain)
const FIRST_LOOK_BACK = 100; // blocks (about 5 minutes) when an address is scanned for the first time

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function rpc(method: string, params: unknown[]): Promise<{ result?: unknown; error?: { code?: number; message?: string } }> {
  let last: { error: { message: string } } = { error: { message: "no node answered" } };
  for (const url of BSC_NODES) {
    try {
      const res = await fetch(url, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(10_000),
      });
      const j = await res.json();
      if (j?.error) { last = { error: j.error }; continue; } // a node that refuses (limit exceeded): try the next one
      if (j?.result !== undefined) return j;
    } catch {
      last = { error: { message: "node unreachable" } };
    }
  }
  return last;
}

const hexToNumber = (v: unknown): number | null => (typeof v === "string" && /^0x[0-9a-f]+$/i.test(v) ? Number(BigInt(v)) : null);

async function evmLogs(address: string, from: number, to: number, depth = 0): Promise<unknown[] | null> {
  const r = await rpc("eth_getLogs", [{
    fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16), address: BEP20_USDT,
    topics: [TRANSFER_TOPIC, null, addressTopic(address)],
  }]);
  if (Array.isArray(r.result)) return r.result;
  const halves = depth < 4 ? splitRange(from, to) : null; // "limit exceeded": ask for smaller pieces
  if (!halves) return null;
  const a = await evmLogs(address, halves[0][0], halves[0][1], depth + 1);
  const b = a ? await evmLogs(address, halves[1][0], halves[1][1], depth + 1) : null;
  return a && b ? [...a, ...b] : null;
}

async function report(chain: "bep20" | "trc20", error: string | null) {
  await db.rpc("crypto_report", { p_chain: chain, p_error: error });
}

/** Hands one transfer to the database. A failure stops the look BEFORE the position is moved on, so the same transfers are tried again next minute. */
async function ingest(chain: "bep20" | "trc20", t: Transfer, fallbackTime: number) {
  const { data, error } = await db.rpc("crypto_ingest", {
    p_chain: chain, p_tx: t.tx, p_log: t.logIndex, p_from: t.from, p_to: t.to, p_amount: t.amount,
    p_block: t.block, p_time: new Date(t.timeMs ?? fallbackTime).toISOString(),
  });
  if (error) throw new Error("database refused a transfer");
  if (data === "matched") paid = true;
}

/** Set when a transfer just paid an order: the website is told right away instead of at the next minute's delivery run. */
let paid = false;
async function tellWebsites() {
  if (!paid) return;
  paid = false;
  try {
    const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/gateway/deliver`, { method: "POST", body: "{}", signal: AbortSignal.timeout(15_000) });
    await res.body?.cancel();
  } catch {
    // the once-a-minute delivery run sends it anyway
  }
}

async function watchBep20(address: string, cursor: number | null): Promise<void> {
  const head = hexToNumber((await rpc("eth_blockNumber", [])).result);
  if (head === null) return await report("bep20", "could not read the latest block");
  const safe = head - BEP20_CONFIRMATIONS;
  const from = cursor === null ? safe - FIRST_LOOK_BACK : cursor + 1;
  if (from > safe) return await report("bep20", null);
  const to = Math.min(safe, from + MAX_RANGE - 1);
  const logs = await evmLogs(address, from, to);
  if (logs === null) return await report("bep20", "the blockchain server refused the request");
  const blockTimes = new Map<number, number>();
  for (const raw of logs) {
    const t = parseEvmLog(raw as Parameters<typeof parseEvmLog>[0]);
    if (!t) continue;
    let timeMs = t.timeMs;
    if (timeMs === null && t.block !== null) {
      if (!blockTimes.has(t.block)) {
        const b = await rpc("eth_getBlockByNumber", ["0x" + t.block.toString(16), false]);
        const ts = hexToNumber((b.result as { timestamp?: string } | undefined)?.timestamp);
        blockTimes.set(t.block, ts === null ? Date.now() : ts * 1000);
      }
      timeMs = blockTimes.get(t.block) ?? Date.now();
    }
    await ingest("bep20", { ...t, timeMs }, Date.now());
  }
  await db.rpc("crypto_set_cursor", { p_chain: "bep20", p_value: to });
  await report("bep20", null);
}

async function watchTrc20(address: string, since: number | null): Promise<void> {
  const min = since ?? Date.now() - 10 * 60_000;
  const url = `https://api.trongrid.io/v1/accounts/${encodeURIComponent(address)}/transactions/trc20?only_to=true&only_confirmed=true`
    + `&contract_address=${TRC20_USDT}&limit=200&order_by=block_timestamp,asc&min_timestamp=${min}`;
  let items: unknown[];
  try {
    const res = await fetch(url, { headers: TRONGRID_KEY ? { "TRON-PRO-API-KEY": TRONGRID_KEY } : {}, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return await report("trc20", `TronGrid answered ${res.status}`);
    const j = await res.json();
    items = Array.isArray(j?.data) ? j.data : [];
  } catch {
    return await report("trc20", "TronGrid could not be reached");
  }
  let newest = min;
  for (const raw of items) {
    const t = parseTronItem(raw as Parameters<typeof parseTronItem>[0]);
    if (!t) continue;
    await ingest("trc20", t, Date.now());
    if (t.timeMs !== null && t.timeMs > newest) newest = t.timeMs;
  }
  // The next look starts at the newest transfer seen, but never later than three minutes ago: TronGrid confirms transfers a little out of
  // order, so a transfer can show up after a later one. Looking at the same few minutes twice is harmless (each transfer is stored once).
  await db.rpc("crypto_set_cursor", { p_chain: "trc20", p_value: Math.min(items.length ? newest : Date.now(), Date.now() - 180_000) });
  await report("trc20", null);
}

Deno.serve(async () => {
  const { data: s } = await db.from("crypto_settings").select("*").eq("id", true).maybeSingle();
  if (s?.bep20_enabled && s.bep20_address) {
    try { await watchBep20(s.bep20_address, s.bep20_block ?? null); } catch { console.error("bep20 look failed"); await report("bep20", "the look failed, trying again"); }
  }
  if (s?.trc20_enabled && s.trc20_address) {
    try { await watchTrc20(s.trc20_address, s.trc20_since ?? null); } catch { console.error("trc20 look failed"); await report("trc20", "the look failed, trying again"); }
  }
  await tellWebsites();
  return json({ ok: true });
});
