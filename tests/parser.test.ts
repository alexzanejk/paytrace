import { parseSms, senderMatchesProvider } from "../supabase/functions/ingest/parser.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}
function parsed(raw: string, hint?: string) {
  const r = parseSms(raw, hint);
  return r.kind === "parsed" ? r.data : null;
}

// ---- Real samples supplied by the user ----
const nagadCashOut = `Cash Out Received.
Amount: Tk 2686.00
Customer: 019****8944
TxnID: 75WF5GOZ
Comm: Tk 11.01
Balance: Tk 15312.15
29/08/2026 16:43`;
let p = parsed(nagadCashOut, "nagad");
check("nagad cash out parsed", !!p, parseSms(nagadCashOut, "nagad"));
check("nagad cash out type", p?.txnType === "cash_out");
check("nagad cash out amount 2686", p?.amount === 2686);
check("nagad cash out commission 11.01 (separate from fee)", p?.commission === 11.01 && p?.fee === 0);
check("nagad cash out trx", p?.trxId === "75WF5GOZ");
check("nagad cash out balance", p?.balance === 15312.15);
check("nagad cash out customer masked", p?.counterparty === "019****8944");
check("nagad cash out time (BD)", p?.occurredAt === "2026-08-29T16:43:00+06:00", p?.occurredAt);
check("nagad auto-detected without hint", parsed(nagadCashOut)?.provider === "nagad");

const bkashCashOut = `Cash Out Tk 2,400.00 from 0175XXXX956 successful. Fee Tk 0.00. Balance Tk 11,758.11. TrxID DIH0LC20C8 at 17/09/2026 18:04`;
p = parsed(bkashCashOut, "bkash");
check("bkash cash out parsed", !!p, parseSms(bkashCashOut, "bkash"));
check("bkash cash out type", p?.txnType === "cash_out");
check("bkash cash out amount 2400 (comma)", p?.amount === 2400);
check("bkash cash out fee 0", p?.fee === 0);
check("bkash cash out balance", p?.balance === 11758.11);
check("bkash cash out trx", p?.trxId === "DIH0LC20C8");
check("bkash cash out counterparty", p?.counterparty === "0175XXXX956");
check("bkash cash out time (BD)", p?.occurredAt === "2026-09-17T18:04:00+06:00", p?.occurredAt);
check("bkash auto-detected without hint", parsed(bkashCashOut)?.provider === "bkash");

// ---- Layouts written from general knowledge, NOT yet verified against real SMS ----
const bkashRecv = `You have received Tk 1,250.50 from 01712345678. Fee Tk 0.00. Balance Tk 5,000.00. TrxID ABC123XYZ9 at 16/10/2026 10:05`;
p = parsed(bkashRecv, "bkash");
check("bkash send money received", p?.txnType === "send_money_received" && p.amount === 1250.5 && p.trxId === "ABC123XYZ9");
const bkashPay = `You have received payment Tk 500.00 from 01712345678. Fee Tk 5.00. Balance Tk 5,500.00. TrxID PAY123XYZ9 at 16/10/2026 10:05`;
p = parsed(bkashPay, "bkash");
check("bkash payment received + fee kept separate", p?.txnType === "payment_received" && p.amount === 500 && p.fee === 5);
const nagadRecv = `Money Received.
Amount: Tk 800.00
Sender: 01812345678
Ref: N/A
TxnID: 74ABCDEF
Balance: Tk 3000.00
16/10/2026 11:00`;
p = parsed(nagadRecv, "nagad");
check("nagad send money received", p?.txnType === "send_money_received" && p.amount === 800 && p.counterparty === "01812345678");

// ---- Must NOT produce payments ----
check("failed txn ignored", parseSms("Transaction failed. Insufficient balance. TrxID ABC123XYZ9", "bkash").kind === "ignored");
check("'unsuccessful' not mistaken for successful", parseSms("Cash Out Tk 100.00 from 0175XXXX956 unsuccessful. TrxID ABC123XYZ9", "bkash").kind === "ignored");
check("OTP ignored", parseSms("Your bKash verification code is 123456", "bkash").kind === "ignored");
check("garbage -> failed, not parsed", parseSms("Hello how are you", "bkash").kind === "failed");
check("bkash text lacking trx -> failed", parseSms("You have received Tk 500.00 from 01712345678.", "bkash").kind === "failed");
check("bad date -> null date, still parsed", parsed("You have received Tk 5.00 from 01712345678. Fee Tk 0.00. Balance Tk 9.00. TrxID ABC123XYZ9 at 99/99/2026 25:99", "bkash")?.occurredAt === null);

// ---- Generic (Rocket/Upay) is flagged unverified ----
p = parsed("Tk500.00 received from 01712345678. Fee Tk0.00. Balance Tk 900.00. TxnId: RKT123456", "rocket");
check("rocket generic is flagged unverified", p?.confidence === "generic" && p.amount === 500, p);

// ---- Sender ID spoof check ----
check("sender bKash ok", senderMatchesProvider("bKash", "bkash"));
check("sender random number rejected", !senderMatchesProvider("01712345678", "bkash"));
check("sender missing rejected", !senderMatchesProvider(undefined, "nagad"));
check("rocket sender 16216", senderMatchesProvider("16216", "rocket"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
