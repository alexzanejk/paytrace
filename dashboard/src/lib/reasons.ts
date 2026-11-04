/** Turns the reason the server recorded into something the owner can act on.
 *  `amount_mismatch` arrives with the two figures appended, so it is matched by prefix. */
const PLAIN: [string, string][] = [
  ["amount_mismatch", "Amount does not match the order"],
  ["phone_mismatch", "Paid from a different phone number"],
  ["order_expired_before_payment", "The order had already expired"],
  ["wrong_phone", "Arrived on a different phone than the number the customer was shown"],
  ["unsupported_type", "This kind of message cannot credit an order"],
  ["unrecognized_type", "Could not tell what kind of payment this is"],
  ["b2b_transfer_out", "Money your agent sent to the distributor (B2B). Not a customer payment; kept only so the balance adds up"],
  ["cash_in_sent", "A cash-in your agent made: e-money sent out to a customer's wallet. Not a customer payment; kept so the balance adds up and counted under Cash In"],
  ["paid_before_order", "Paid before the order was created, so it may be an older receipt (someone else's, or a reused one)"],
  ["cash_in_received", "Money came IN by Cash In from an agent. If a customer paid this way at an agent counter, credit it to their order; if it is your own top-up, ignore it"],
  ["b2b_received", "e-money your distributor sent to the agent wallet (B2B). Not a customer payment; kept only so the balance adds up"],
  ["payment_sent", "A merchant payment made from the wallet. Not a customer payment; kept so the balance adds up"],
  ["bill_paid", "A bill paid from the wallet. Not a customer payment; kept so the balance adds up"],
  ["loan_repaid", "A bKash loan repayment from the wallet. Not a customer payment; kept so the balance adds up"],
  ["unverified_format", "Message format not confirmed yet, held to be safe"],
  ["balance_chain_mismatch", "Account balance does not follow the previous message — possibly a fake SMS"],
];

export function reviewReasonText(reason: string | null): string | null {
  if (!reason) return null;
  const hit = PLAIN.find(([key]) => reason.startsWith(key));
  if (!hit) return reason;
  // Keep the figures the server added after "amount_mismatch:".
  const extra = reason.slice(hit[0].length).replace(/^:\s*/, "");
  return extra ? `${hit[1]} (${extra})` : hit[1];
}
