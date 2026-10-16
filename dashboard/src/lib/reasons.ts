/** Turns the reason the server recorded into something the owner can act on.
 *  `amount_mismatch` arrives with the two figures appended, so it is matched by prefix. */
const PLAIN: [string, string][] = [
  ["amount_mismatch", "Amount does not match the order"],
  ["phone_mismatch", "Paid from a different phone number"],
  ["order_expired_before_payment", "The order had already expired"],
  ["unsupported_type", "This kind of message cannot credit an order"],
  ["unrecognized_type", "Could not tell what kind of payment this is"],
  ["unverified_format", "Message format not confirmed yet, held to be safe"],
];

export function reviewReasonText(reason: string | null): string | null {
  if (!reason) return null;
  const hit = PLAIN.find(([key]) => reason.startsWith(key));
  if (!hit) return reason;
  // Keep the figures the server added after "amount_mismatch:".
  const extra = reason.slice(hit[0].length).replace(/^:\s*/, "");
  return extra ? `${hit[1]} (${extra})` : hit[1];
}
