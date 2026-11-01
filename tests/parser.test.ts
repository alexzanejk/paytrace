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


// ---- Rocket agent receipt (real sample from sender 16216) ----
const rocketCashOut =
  `B2C: Cash-Out from A/C: ***460 Tk500.00 Comm:Tk2.10; A/C Balance: Tk36,068.90.` +
  `TxnId: 6889402212 Date:28-AUG-26 11:04:50 pm. Download https://bit.ly/nexuspay`;
p = parsed(rocketCashOut, "rocket");
check("rocket cash out parsed", !!p, parseSms(rocketCashOut, "rocket"));
check("rocket cash out type", p?.txnType === "cash_out");
check("rocket amount 500 (no space after Tk)", p?.amount === 500);
check("rocket commission 2.10", p?.commission === 2.1);
check("rocket balance 36068.90", p?.balance === 36068.9);
check("rocket trx id", p?.trxId === "6889402212");
check("rocket account masked", p?.counterparty === "***460");
check("rocket pm time -> 23:04:50 BD", p?.occurredAt === "2026-08-28T23:04:50+06:00", p?.occurredAt);
check("rocket layout is trusted, not generic", p?.confidence === "exact");
check("rocket auto-detected without hint", parsed(rocketCashOut)?.provider === "rocket");

// An am time must not be pushed into the afternoon.
const rocketAm = rocketCashOut.replace("11:04:50 pm", "11:40:00 am");
check("rocket am time stays morning", parsed(rocketAm, "rocket")?.occurredAt === "2026-08-28T11:40:00+06:00", parsed(rocketAm, "rocket")?.occurredAt);

// ---- Rocket B2B outgoing (real sample): the agent sent money to the distributor, it is NOT a customer payment ----
const rocketB2B = "B2B: Cash-Out to A/C: ***238 Tk1,040.00, Your A/C Balance: Tk16.18.TxnId: 7096347555 Date:28-OCT-26 12:49:03 pm.";
p = parsed(rocketB2B, "rocket");
check("rocket b2b parsed", !!p, parseSms(rocketB2B, "rocket"));
check("rocket b2b is outgoing, never cash_out or received", p?.txnType === "transfer_out");
check("rocket b2b amount 1040", p?.amount === 1040);
check("rocket b2b balance 16.18", p?.balance === 16.18);
check("rocket b2b trx id", p?.trxId === "7096347555");
check("rocket b2b account masked", p?.counterparty === "***238");
check("rocket b2b noon time 12:49 pm stays 12:49", p?.occurredAt === "2026-10-28T12:49:03+06:00", p?.occurredAt);
check("rocket b2b trusted layout", p?.confidence === "exact");
check("rocket b2b auto-detected without hint", parsed(rocketB2B)?.provider === "rocket");
check("unknown b2b layout is never read as customer money", parseSms("B2B: Cash-In from A/C: ***238 Tk500.00 Balance: Tk900.00 TxnId: ABC1234567", "rocket").kind === "failed");

// A Rocket message in an unknown layout still falls back to the cautious reader.
const rocketOther = "Your Rocket account received Tk 300.00. TxnId: 6891223763. Balance Tk 100.00";
check("unknown rocket layout stays generic", parsed(rocketOther, "rocket")?.confidence === "generic");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
