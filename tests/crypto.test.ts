import {
  addressTopic, BEP20_USDT, formatUnits, parseEvmLog, parseTronItem, splitRange, TRANSFER_TOPIC, TRC20_USDT,
} from "../supabase/functions/crypto-watch/logic.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

// ---- amounts are exact, never floating point ----
check("18 decimals: 10.0005 USDT", formatUnits(10_000_500_000_000_000_000n, 18) === "10.0005");
check("whole numbers have no point", formatUnits(25_000_000_000_000_000_000n, 18) === "25");
check("tiny amounts keep their zeros", formatUnits(1_000_000_000_000_000n, 18) === "0.001" && formatUnits(1n, 18) === "0.000000000000000001");
check("6 decimals (TRON)", formatUnits(98600n, 6) === "0.0986" && formatUnits(20_007_100n, 6) === "20.0071");
check("an amount a hair more than asked is a different amount", formatUnits(10_000_500_000_000_001n * 1_000_000n, 18) !== "10.0005");

// ---- the receiving address as a log filter ----
check("topic = 0x + 24 zeros + 20 bytes, lower case", addressTopic("0x1111111111111111111111111111111111111111") === "0x" + "0".repeat(24) + "1".repeat(40) && addressTopic("0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD").endsWith("abcdefabcdefabcdefabcdefabcdefabcdefabcd"));

// ---- a real BNB Smart Chain log (shape taken from a live node) ----
const log = {
  address: "0x55d398326f99059ff775485246999027b3197955",
  topics: [
    TRANSFER_TOPIC,
    "0x00000000000000000000000006fd4ba7973a0d39a91734bbc35bc2bcaa99e3b0",
    "0x0000000000000000000000008894e0a0c962cb723c1976a4421c95949be2d4e3",
  ],
  data: "0x0000000000000000000000000000000000000000000005ea9fb9dc2be1040000",
  blockNumber: "0x7bcff2a",
  blockTimestamp: "0x6adeca92",
  transactionHash: "0x63e04644dcc3c8c0cb53ac8ae2ca50fad4fc192bf8b5fee5494692f1494e91c6",
  logIndex: "0x11a",
  removed: false,
};
const t = parseEvmLog(log)!;
check("an EVM log is read: hash, log index, addresses, block, time", t.tx === log.transactionHash && t.logIndex === 282 && t.from === "0x06fd4ba7973a0d39a91734bbc35bc2bcaa99e3b0"
  && t.to === "0x8894e0a0c962cb723c1976a4421c95949be2d4e3" && t.block === 0x7bcff2a && t.timeMs === 0x6adeca92 * 1000, t);
check("the amount of that log is exact", t.amount === "27939.88", t.amount);
check("a removed (reorganised) log is refused", parseEvmLog({ ...log, removed: true }) === null);
check("a log with the wrong event or shape is refused", parseEvmLog({ ...log, topics: ["0x" + "1".repeat(64), log.topics[1], log.topics[2]] }) === null
  && parseEvmLog({ ...log, topics: [log.topics[0], log.topics[1]] }) === null && parseEvmLog({ ...log, data: "0x" }) === null && parseEvmLog({ ...log, transactionHash: "0x12" }) === null);
check("a log without a block time still parses (the watcher asks the block)", parseEvmLog({ ...log, blockTimestamp: undefined })?.timeMs === null);

// ---- a real TronGrid record ----
const item = {
  transaction_id: "d53194b0aff2c95fda4b371ec5bf8a28c317a6c290dc55f80f45dff4afdaa180",
  token_info: { symbol: "USDT", address: TRC20_USDT, decimals: 6, name: "Tether USD" },
  block_timestamp: 1792982796000,
  from: "TSvgLWQLp2z986zK28JBjY9eDMRX3p9MmW",
  to: TRC20_USDT,
  type: "Transfer",
  value: "98600",
};
const tt = parseTronItem(item)!;
check("a TRON record is read", tt.tx === item.transaction_id && tt.amount === "0.0986" && tt.timeMs === 1792982796000 && tt.from === item.from && tt.to === item.to, tt);
check("another token (a look-alike) is refused", parseTronItem({ ...item, token_info: { ...item.token_info, address: "TXLookAlike000000000000000000000000" } }) === null);
check("a malformed record is refused", parseTronItem({ ...item, transaction_id: "xyz" }) === null && parseTronItem({ ...item, value: "-5" }) === null && parseTronItem({ ...item, value: "1.5" }) === null
  && parseTronItem({ ...item, type: "Approval" }) === null && parseTronItem({ ...item, block_timestamp: undefined as unknown as number }) === null);
check("the contract constants are the real USDT contracts", BEP20_USDT.toLowerCase() === log.address && TRC20_USDT === "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t");

// ---- nodes that refuse big ranges ----
const halves = splitRange(100, 199)!;
check("a range is split into two that together cover it exactly", halves[0][0] === 100 && halves[1][1] === 199 && halves[0][1] + 1 === halves[1][0], halves);
check("a single block cannot be split", splitRange(5, 5) === null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
