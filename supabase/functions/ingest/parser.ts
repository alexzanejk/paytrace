// SMS parsers for bKash / Nagad / Rocket (exact formats) and Upay (generic, held for review).
// Pure functions, no I/O, so they can be unit tested anywhere.

export type Provider = "bkash" | "nagad" | "rocket" | "upay";
export type TxnType = "payment_received" | "send_money_received" | "cash_out" | "transfer_out" | "unknown";

export interface Parsed {
  provider: Provider;
  txnType: TxnType;
  trxId: string;
  amount: number;
  fee: number;
  commission: number;
  balance: number | null;
  counterparty: string | null;
  occurredAt: string | null; // ISO string, Bangladesh time (+06:00)
  confidence: "exact" | "generic"; // generic = format not verified against real samples
}

export type ParseResult =
  | { kind: "parsed"; data: Parsed }
  | { kind: "ignored"; reason: string }
  | { kind: "failed"; reason: string };

// Alphanumeric SMS sender IDs each provider uses.
export const SENDER_IDS: Record<Provider, string[]> = {
  bkash: ["bkash"],
  nagad: ["nagad"],
  rocket: ["16216"],
  upay: ["upay"],
};

export function senderMatchesProvider(sender: string | undefined | null, provider: Provider): boolean {
  if (!sender) return false;
  return SENDER_IDS[provider].includes(sender.trim().toLowerCase());
}

const NUM = "([\\d,]+(?:\\.\\d+)?)";

function num(s: string | undefined | null): number | null {
  if (s == null) return null;
  const n = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function pick(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m ? m[1] : null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const iso = (y: number, mo: number, d: number, h: number, mi: number, s: number): string | null => {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:${p(s)}+06:00`;
};

// SMS times are Bangladesh local time. Two layouts are in use:
//   bKash / Nagad  "17/09/2026 18:04"
//   Rocket         "28-AUG-26 11:04:50 pm"
function parseDate(text: string): string | null {
  const named = text.match(/(\d{1,2})-([A-Za-z]{3})-(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (named) {
    const [, dd, mon, yy, HH, MI, SS, ampm] = named;
    const mo = MONTHS[mon.toLowerCase()];
    if (mo) {
      const year = yy.length === 2 ? 2000 + +yy : +yy;
      let h = +HH;
      const half = ampm?.toLowerCase();
      if (half === "pm" && h < 12) h += 12;
      if (half === "am" && h === 12) h = 0;
      return iso(year, mo, +dd, h, +MI, SS ? +SS : 0);
    }
  }
  const m = text.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, dd, mm, yyyy, HH, MI, SS] = m;
  return iso(+yyyy, +mm, +dd, +HH, +MI, SS ? +SS : 0);
}

const FAILURE_WORDS = /\b(failed|unsuccessful|reversed|reversal|refund(?:ed)?|cancell?ed|declined|insufficient|invalid|otp|verification code|pin)\b/i;

export function normalize(raw: string): string {
  return raw.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
}

export function detectProvider(text: string, hint?: string | null): Provider | null {
  const h = (hint ?? "").toLowerCase();
  if (h === "bkash" || h === "nagad" || h === "rocket" || h === "upay") return h;
  if (/A\/C\s*Balance/i.test(text) && /TxnId\s*:/i.test(text)) return "rocket";
  if (/TxnID\s*:/i.test(text) && /Amount\s*:/i.test(text)) return "nagad";
  if (/TrxID\s+[A-Z0-9]{6,}/i.test(text)) return "bkash";
  return null;
}

function parseBkash(text: string): ParseResult {
  let txnType: TxnType | null = null;
  let amount: number | null = null;
  let who: string | null = null;

  let m = text.match(new RegExp(`Cash\\s*Out\\s+Tk\\s*${NUM}\\s+from\\s+([\\dXx*]+)`, "i"));
  if (m) {
    txnType = "cash_out"; amount = num(m[1]); who = m[2];
  } else if ((m = text.match(new RegExp(`You have received payment\\s+Tk\\s*${NUM}\\s+from\\s+([\\dXx*]+)`, "i")))) {
    txnType = "payment_received"; amount = num(m[1]); who = m[2];
  } else if ((m = text.match(new RegExp(`You have received\\s+Tk\\s*${NUM}\\s+from\\s+([\\dXx*]+)`, "i")))) {
    txnType = "send_money_received"; amount = num(m[1]); who = m[2];
  }
  if (!txnType || amount == null) return { kind: "failed", reason: "bkash: unrecognized message layout" };

  const trx = pick(text, /TrxID\s+([A-Z0-9]{6,})/i);
  if (!trx) return { kind: "failed", reason: "bkash: no TrxID" };

  return {
    kind: "parsed",
    data: {
      provider: "bkash",
      txnType,
      trxId: trx.toUpperCase(),
      amount,
      fee: num(pick(text, new RegExp(`Fee\\s+Tk\\s*${NUM}`, "i"))) ?? 0,
      // bKash SMS does not state agent commission; the balance chain recovers it on the server.
      commission: 0,
      balance: num(pick(text, new RegExp(`Balance\\s+Tk\\s*${NUM}`, "i"))),
      counterparty: who,
      occurredAt: parseDate(text),
      confidence: "exact",
    },
  };
}

function parseNagad(text: string): ParseResult {
  const header = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  let txnType: TxnType | null = null;
  if (/cash\s*out/i.test(header)) txnType = "cash_out";
  else if (/payment\s+received/i.test(header)) txnType = "payment_received";
  else if (/money\s+received|received/i.test(header)) txnType = "send_money_received";
  if (!txnType) return { kind: "failed", reason: "nagad: unrecognized header" };

  const amount = num(pick(text, new RegExp(`^\\s*Amount\\s*:\\s*Tk\\.?\\s*${NUM}`, "im")));
  const trx = pick(text, /^\s*Txn\s?ID\s*:\s*([A-Z0-9]{6,})/im);
  if (amount == null || !trx) return { kind: "failed", reason: "nagad: missing amount or TxnID" };

  return {
    kind: "parsed",
    data: {
      provider: "nagad",
      txnType,
      trxId: trx.toUpperCase(),
      amount,
      fee: num(pick(text, new RegExp(`^\\s*Fee\\s*:\\s*Tk\\.?\\s*${NUM}`, "im"))) ?? 0,
      commission: num(pick(text, new RegExp(`^\\s*Comm(?:ission)?\\s*:\\s*Tk\\.?\\s*${NUM}`, "im"))) ?? 0,
      balance: num(pick(text, new RegExp(`^\\s*Balance\\s*:\\s*Tk\\.?\\s*${NUM}`, "im"))),
      counterparty: pick(text, /^\s*(?:Customer|Sender|From)\s*:\s*([\dXx*+\-]+)/im),
      occurredAt: parseDate(text),
      confidence: "exact",
    },
  };
}

// Rocket (sender 16216), confirmed against a real agent receipt:
//   "B2C: Cash-Out from A/C: ***460 Tk500.00 Comm:Tk2.10; A/C Balance: Tk36,068.90.
//    TxnId: 6889402212 Date:28-AUG-26 11:04:50 pm"
//
// B2B outgoing (owner's real sample): the AGENT sends e-money to the distributor (DSO). Not a customer payment:
//   "B2B: Cash-Out to A/C: ***238 Tk1,040.00, Your A/C Balance: Tk16.18.TxnId: 7096347555 Date:28-OCT-26 12:49:03 pm."
// The balance FALLS by the amount, so the server keeps it only to keep the balance chain right.
function parseRocketB2B(text: string): ParseResult | null {
  const m = text.match(new RegExp(`B2B\\s*:?\\s*Cash[\\s-]*Out\\s+to\\s+A/C\\s*:?\\s*([*\\dXx]+)\\s+Tk\\.?\\s*${NUM}`, "i"));
  if (!m) return null;
  const amount = num(m[2]);
  if (amount == null) return null;
  const trx = pick(text, /TxnId\s*:?\s*([A-Z0-9]{6,})/i);
  if (!trx) return { kind: "failed", reason: "rocket: no TxnId" };
  return {
    kind: "parsed",
    data: {
      provider: "rocket",
      txnType: "transfer_out",
      trxId: trx.toUpperCase(),
      amount,
      fee: num(pick(text, new RegExp(`Fee\\s*:?\\s*Tk\\.?\\s*${NUM}`, "i"))) ?? 0,
      commission: 0,
      balance: num(pick(text, new RegExp(`A/C\\s*Balance\\s*:?\\s*Tk\\.?\\s*${NUM}`, "i"))),
      counterparty: m[1],
      occurredAt: parseDate(text),
      confidence: "exact",
    },
  };
}

function parseRocket(text: string): ParseResult | null {
  const b2b = parseRocketB2B(text);
  if (b2b) return b2b;
  const m = text.match(
    new RegExp(`Cash[\\s-]*Out\\s+from\\s+A/C\\s*:?\\s*([*\\dXx]+)\\s+Tk\\.?\\s*${NUM}`, "i"),
  );
  if (!m) return null;
  const [, account, rawAmount] = m;
  const amount = num(rawAmount);
  if (amount == null) return null;
  const trx = pick(text, /TxnId\s*:?\s*([A-Z0-9]{6,})/i);
  if (!trx) return { kind: "failed", reason: "rocket: no TxnId" };
  return {
    kind: "parsed",
    data: {
      provider: "rocket",
      txnType: "cash_out",
      trxId: trx.toUpperCase(),
      amount,
      fee: num(pick(text, new RegExp(`Fee\\s*:?\\s*Tk\\.?\\s*${NUM}`, "i"))) ?? 0,
      commission: num(pick(text, new RegExp(`Comm(?:ission)?\\s*:?\\s*Tk\\.?\\s*${NUM}`, "i"))) ?? 0,
      balance: num(pick(text, new RegExp(`A/C\\s*Balance\\s*:?\\s*Tk\\.?\\s*${NUM}`, "i"))),
      counterparty: account,
      occurredAt: parseDate(text),
      confidence: "exact",
    },
  };
}

// Rocket (other layouts) / Upay: no verified samples yet. Best-effort extraction; the server holds these for review.
function parseGeneric(provider: Provider, text: string): ParseResult {
  const trx = pick(text, /(?:Trx\s?ID|Txn\s?ID|TID|Transaction\s?ID)\s*[:\-]?\s*([A-Z0-9]{6,})/i);
  const amount = num(pick(text, new RegExp(`Tk\\.?\\s*${NUM}`, "i")));
  if (!trx || amount == null) return { kind: "failed", reason: `${provider}: could not find TrxID and amount` };
  if (/\bB2B\b/i.test(text)) return { kind: "failed", reason: `${provider}: unrecognized B2B layout (not a customer payment)` };
  const isCashOut = /cash[\s-]*out/i.test(text);
  const received = /received|credited|cash\s*in/i.test(text);
  return {
    kind: "parsed",
    data: {
      provider,
      txnType: isCashOut ? "cash_out" : received ? "send_money_received" : "unknown",
      trxId: trx.toUpperCase(),
      amount,
      fee: num(pick(text, new RegExp(`Fee\\s*[:\\-]?\\s*Tk\\.?\\s*${NUM}`, "i"))) ?? 0,
      commission: num(pick(text, new RegExp(`Comm(?:ission)?\\s*[:\\-]?\\s*Tk\\.?\\s*${NUM}`, "i"))) ?? 0,
      balance: num(pick(text, new RegExp(`Balance\\s*[:\\-]?\\s*Tk\\.?\\s*${NUM}`, "i"))),
      counterparty: pick(text, /(?:from|sender|customer)\s*[:\-]?\s*([\dXx*+]{7,})/i),
      occurredAt: parseDate(text),
      confidence: "generic",
    },
  };
}

export function parseSms(raw: string, providerHint?: string | null): ParseResult {
  const text = normalize(raw);
  if (!text) return { kind: "ignored", reason: "empty" };
  if (FAILURE_WORDS.test(text) && !/\bsuccessful\b/i.test(text)) {
    return { kind: "ignored", reason: "failure/reversal/OTP message" };
  }
  const provider = detectProvider(text, providerHint);
  if (!provider) return { kind: "failed", reason: "unknown provider" };
  if (provider === "bkash") return parseBkash(text);
  if (provider === "nagad") return parseNagad(text);
  if (provider === "rocket") {
    const exact = parseRocket(text);
    if (exact) return exact;
  }
  return parseGeneric(provider, text);
}
