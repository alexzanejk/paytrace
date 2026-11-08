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
// Real layout 2026-11-05 (number changed): a MERCHANT account pays, so "from" carries a name with the number on the end.
const bkashRecvNamed = `You have received Tk 500.00 from SOME HAIR CUTTING SALOON_01611000335 01611000335. Fee Tk 0.00. Balance Tk 3,172.31. TrxID DK52TEST01 at 05/11/2026 01:00`;
p = parsed(bkashRecvNamed, "bkash");
check("bkash received from a NAMED payer still reads", p?.txnType === "send_money_received" && p.amount === 500 && p.trxId === "DK52TEST01", p);
check("the named payer's number is kept as the counterparty", p?.counterparty === "01611000335", p?.counterparty);
check("a payer with no number keeps the name", parsed("You have received Tk 20.00 from ABC STORE. Fee Tk 0.00. Balance Tk 30.00. TrxID DK52TEST02 at 05/11/2026 01:00", "bkash")?.counterparty === "ABC STORE");
check("a masked payer stays as written", parsed(bkashRecv.replace("01712345678", "0171XXXX678"), "bkash")?.counterparty === "0171XXXX678");
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
// ---- bKash AGENT cash-in receipt (real sample 2026-11-04): the agent gave e-money to a customer, money LEFT the wallet ----
const bkashCashIn = "Cash In Tk 200.00 to 0161XXXX190 successful. Fee Tk 0.00. Balance Tk 6,806.69. TrxID DK46191BOA at 04/11/2026 11:08";
p = parsed(bkashCashIn, "bkash");
check("bkash agent cash-in parsed", !!p, parseSms(bkashCashIn, "bkash"));
check("bkash agent cash-in is outgoing money, never a customer payment", p?.txnType === "transfer_out" && p?.flowKind === "cash_in");
check("bkash agent cash-in amount, balance, trx, time", p?.amount === 200 && p?.balance === 6806.69 && p?.trxId === "DK46191BOA" && p?.occurredAt === "2026-11-04T11:08:00+06:00");
check("bkash agent cash-in auto-detected without hint", parsed(bkashCashIn)?.provider === "bkash");
check("rocket b2b names its kind", parsed(rocketB2B, "rocket")?.flowKind === "b2b");
// ---- the wallet's OWN cash-out at an agent (real sample 2026-11-04, 10 in the log): money LEFT the wallet ----
const bkashOwnCashOut = "Cash Out Tk 7,000.00 to 01704241450 successful. Fee Tk 129.50. Balance Tk 5,961.98. TrxID DK491M7LTT at 04/11/2026 15:15";
p = parsed(bkashOwnCashOut, "bkash");
check("bkash own cash-out parsed", !!p, parseSms(bkashOwnCashOut, "bkash"));
check("bkash own cash-out is outgoing money, never a customer payment", p?.txnType === "transfer_out" && p?.flowKind === "cash_out");
check("bkash own cash-out amount, fee, balance, trx", p?.amount === 7000 && p?.fee === 129.5 && p?.balance === 5961.98 && p?.trxId === "DK491M7LTT");
check("a customer's Cash Out FROM a number is still a receipt", parsed("Cash Out Tk 500.00 from 01711111111 successful. Fee Tk 0.00. Balance Tk 6,461.98. TrxID DK4ABCDEFG at 04/11/2026 15:20", "bkash")?.txnType === "cash_out");
check("unknown b2b layout is never read as customer money", parseSms("B2B: Something odd A/C: ***238 Tk500.00 Balance: Tk900.00 TxnId: ABC1234567", "rocket").kind === "failed");

// ---- Layouts that used to fail to parse (real samples from the owner's phones, 2026-10-17 to 2026-11-04). Each is money
// moving on the agent's own side; none may ever be read as a customer payment. ----
const nagadB2BIn = "B2B Received. \nAmount: Tk 5000.00\nSender: 013****7088\nTrxID: 769BQCVS\nBal: Tk 5015.94\n04/11/2026 13:52";
p = parsed(nagadB2BIn, "nagad");
check("nagad B2B Received parsed", !!p, parseSms(nagadB2BIn, "nagad"));
check("nagad B2B Received is incoming transfer, NOT send money", p?.txnType === "transfer_in" && p?.flowKind === "b2b");
check("nagad B2B Received amount, trx (TrxID:), balance (Bal:), sender, time",
  p?.amount === 5000 && p?.trxId === "769BQCVS" && p?.balance === 5015.94 && p?.counterparty === "013****7088" && p?.occurredAt === "2026-11-04T13:52:00+06:00", p);
const nagadCashInOut = "Cash In Successful.\nAmount: Tk 100.00\nCustomer: 016****9601\nTxnID: 768QVSLN\nComm: Tk 0.39\nBalance: Tk 17200.42\n01/11/2026 16:56";
p = parsed(nagadCashInOut, "nagad");
check("nagad agent Cash In parsed", !!p, parseSms(nagadCashInOut, "nagad"));
check("nagad agent Cash In is outgoing money with its commission", p?.txnType === "transfer_out" && p?.flowKind === "cash_in" && p?.commission === 0.39 && p?.amount === 100);
check("nagad customer Cash Out still reads as cash_out", parsed(nagadCashOut, "nagad")?.txnType === "cash_out");

const bkashCashInFrom = "Cash In Tk 540.00 from 01712345678 successful. Fee Tk 0.00. Balance Tk 3,883.93. TrxID DK4ABCDEF1 at 04/11/2026 01:22. Download App: https://bKa.sh/8app";
p = parsed(bkashCashInFrom, "bkash");
check("bkash Cash In FROM an agent is incoming transfer", p?.txnType === "transfer_in" && p?.flowKind === "cash_in" && p?.amount === 540 && p?.balance === 3883.93);
const bkashB2B = "B2B Transfer Tk 7,000.00 to 01812345678 successful. Fee Tk 0.00. Balance Tk 7.49. TrxID DK4B2BXYZ1 at 04/11/2026 14:02";
p = parsed(bkashB2B, "bkash");
check("bkash B2B Transfer is outgoing b2b", p?.txnType === "transfer_out" && p?.flowKind === "b2b" && p?.amount === 7000 && p?.balance === 7.49);
const bkashPay1 = "Payment Tk 589.00 to 01912345678 successful. Ref 12. Fee Tk 0.00. Balance Tk 0.98. TrxID DK2PAY00001 at 02/11/2026 23:10";
const bkashPay2 = "Payment of Tk 829.00 to Doctime Limited-RM12345 is successful. Balance Tk 924.82. TrxID DKIPAY00002 at 18/10/2026 10:11";
check("bkash merchant payment (short form) is outgoing", parsed(bkashPay1, "bkash")?.flowKind === "payment" && parsed(bkashPay1, "bkash")?.amount === 589);
check("bkash merchant payment (long form) is outgoing", parsed(bkashPay2, "bkash")?.flowKind === "payment" && parsed(bkashPay2, "bkash")?.balance === 924.82);
const bkashBill = "Bill successfully paid.\nBiller: BREBPrepaid \nMMYYYY/Contact: 01712345678\nA/C: 12345678 \nAmount: Tk 500.00 \nFee: Tk 10.00 \nTrxID: DKJBILL0001 at 19/10/2026 10:06";
p = parsed(bkashBill, "bkash");
check("bkash bill is outgoing with fee, TrxID after a colon, no balance", p?.flowKind === "bill" && p?.amount === 500 && p?.fee === 10 && p?.trxId === "DKJBILL0001" && p?.balance === null, p);
const bkashLoan = "Your Digital Loan Repayment of Tk 1,751.48 is successful. Balance Tk 31,148.52. TrxID DK1LOAN0001 at 01/11/2026 13:24.";
p = parsed(bkashLoan, "bkash");
check("bkash loan repayment is outgoing", p?.flowKind === "loan" && p?.amount === 1751.48 && p?.balance === 31148.52);
check("bkash customer payment still reads as payment_received", parsed("You have received payment Tk 500.00 from 01712345678. Fee Tk 0.00. Balance Tk 1,000.00. TrxID DKRECV00001 at 01/11/2026 10:00", "bkash")?.txnType === "payment_received");
const rocketB2BIn = "B2B: Cash-In from A/C: ***238 Tk500.00, Your A/C Balance: Tk546.59.TxnId: 7103456789 Date:01-NOV-26 11:14:45 pm.";
p = parsed(rocketB2BIn, "rocket");
check("rocket B2B Cash-In is incoming b2b", p?.txnType === "transfer_in" && p?.flowKind === "b2b" && p?.amount === 500 && p?.balance === 546.59 && p?.trxId === "7103456789");
check("rocket mini-statement SMS still fails (no balance, no single amount)", parseSms("7103456789 Dr Tk500.00; 7103456790 Dr Tk20.00; 7103456791 Cr Tk.09", "rocket").kind === "failed");

// A Rocket message in an unknown layout still falls back to the cautious reader.
// A personal account's own Send Money (layouts from general knowledge, 2026-11-08; not yet a real sample).
const bkashSendOut = "Send Money Tk 1,000.00 to 01712345678 successful. Ref 1. Fee Tk 5.00. Balance Tk 2,345.67. TrxID DK8ABC1234 at 08/11/2026 12:00";
p = parsed(bkashSendOut, "bkash");
check("bkash personal Send Money is outgoing money", p?.txnType === "transfer_out" && p?.flowKind === "send_money" && p?.amount === 1000 && p?.fee === 5 && p?.balance === 2345.67 && p?.counterparty === "01712345678");
// The owner's real personal bKash Send Money receipt (recording 2026-11-08), as the wallet printed it.
const bkashSendReal = "Send Money Tk 850.00 to 01719114383 successful. Ref a. Fee Tk 10.00. Balance Tk 14,660.08. TrxID DK817GU2FV at 08/11/2026 12:02";
p = parsed(bkashSendReal, "bkash");
check("the owner's real personal bKash Send Money reads as outgoing", p?.txnType === "transfer_out" && p?.flowKind === "send_money" && p?.amount === 850 && p?.fee === 10 && p?.balance === 14660.08 && p?.trxId === "DK817GU2FV");
const nagadSendOut = "Money Sent.\nAmount: Tk 500.00\nReceiver: 01812345678\nRef: N/A\nTxnID: 76ABCDE1\nFee: Tk 0.00\nBalance: Tk 1234.56\n08/11/2026 12:00";
p = parsed(nagadSendOut, "nagad");
check("nagad personal Money Sent is outgoing money, never Send Money received", p?.txnType === "transfer_out" && p?.flowKind === "send_money" && p?.amount === 500 && p?.counterparty === "01812345678");
const bkashReceived = "You have received Tk 500.00 from 01712345678. Fee Tk 0.00. Balance Tk 1,500.00. TrxID DK8RECV123 at 08/11/2026 12:00";
check("money received is still Send Money received", parsed(bkashReceived, "bkash")?.txnType === "send_money_received");

const rocketOther = "Your Rocket account received Tk 300.00. TxnId: 6891223763. Balance Tk 100.00";
check("unknown rocket layout stays generic", parsed(rocketOther, "rocket")?.confidence === "generic");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
