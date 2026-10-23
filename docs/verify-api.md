# Transaction check API (for the website's admin and super-admin servers)

Ask PayTrace: **"did this transaction ID really arrive in our payment account?"** It answers only `true` or `false`.
It is read-only and never returns amounts, phone numbers or any other detail.

Call it **from your servers only**, never from a browser or app a customer can open: the key would be visible.

## Request

```
POST https://mkjcqwkfbamnuibmurcd.supabase.co/functions/v1/verify-transaction
Authorization: Bearer <your key>   (made on the dashboard, Websites page; starts with ptk_)
Content-Type: application/json

{"transaction_id": "EXAMPLE123", "provider": "bkash", "amount": 500}
```

Optional: `"provider": "bkash" | "nagad" | "rocket" | "upay"` to look only at one provider (send it whenever you know it;
without it all four are searched). Optional: `"amount"`, the amount the customer says they paid, so PayTrace can tell
you whether it matches.
Spaces and lower case are tidied for you (`" bk12ab34cd "` is looked up as `BK12AB34CD`).

## Response

| What happened | HTTP | Body | Show on the card |
|---|---|---|---|
| Exact ID found | 200 | `{"found": true, "provider": "bkash", "amount": 500, "currency": "BDT", "amount_matches": true}` | **Verified** (see below) |
| Not found (or not a possible ID) | 200 | `{"found": false}` | **Unverified** |
| Same ID on two providers and no `provider` sent | 200 | `{"found": true, "ambiguous": true, ...}` | send `provider` and ask again |
| Wrong, missing or revoked key | 401 | `{"error": "unauthorized"}` | fix the key, or ask the owner for a new one |
| Bad request (not JSON, no `transaction_id`, unknown provider) | 400 | `{"error": "..."}` | fix the request |
| Too many lookups (60 per minute per key) | 429 | `{"error": "..."}` | **Pending check**, retry after 60 s |
| Server trouble or timeout | 500 / 503 / no answer | | **Pending check**, retry |

Anything other than a 200 must show **Pending check** and be retried, never "Unverified": a customer who really paid
must not be marked unpaid because of a network problem. Use a timeout of about 5 seconds.

## Checking the amount

When the ID is found you also get the real `provider` and `amount` PayTrace recorded. `amount_matches` is only present
if you sent `amount`; it is `true` when they are equal to the paisa (`500`, `500.0` and `"500.00"` are equal;
`500.01` is not). Suggested card logic: found and `amount_matches` true → **Verified**; found but `amount_matches`
false → **Amount mismatch** (the ID is real but the customer paid a different amount; do not credit the claimed
amount, and credit at most the amount PayTrace reports); not found → **Unverified**.

The response contains only the provider and amount: never phone numbers, balances or message text. Because an
amount is now returned, treat the key like a password: servers only, never in a browser.

## What counts as "found"

- **Any** transaction PayTrace has stored from a provider message: a payment received, a send-money receipt and an
  agent cash-out receipt all count.
- **Not found:** a transaction PayTrace is holding for review (for example a message that could be a fake) and one
  you marked as ignored. A held transaction becomes found once you approve it in the dashboard.
- A transaction that is stored but belongs to a different customer's order still counts as found. Blocking the same ID
  being used twice stays the job of your existing duplicate check.
- A payment SMS that has not reached PayTrace yet (phone off or offline) is **not found** until it arrives. The app
  recovers missed messages when the phone comes back, so a retry later can turn Unverified into Verified.

## Example

```js
// Node 18+, on your server
async function verifyTransaction(id, claimedAmount) {
  try {
    const res = await fetch(
      "https://mkjcqwkfbamnuibmurcd.supabase.co/functions/v1/verify-transaction",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.PAYTRACE_VERIFY_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ transaction_id: id, amount: claimedAmount }), // amount is optional
        signal: AbortSignal.timeout(5000),
      },
    );
    if (res.status !== 200) return "pending";
    const r = await res.json();
    if (r.found !== true) return "unverified";
    if (r.amount_matches === false) return "amount_mismatch"; // r.amount is what was really received
    return "verified";
  } catch {
    return "pending";
  }
}
```

```
curl -X POST https://mkjcqwkfbamnuibmurcd.supabase.co/functions/v1/verify-transaction \
  -H "Authorization: Bearer $PAYTRACE_VERIFY_KEY" -H "Content-Type: application/json" \
  -d '{"transaction_id":"EXAMPLE123","amount":500}'
```

Keep the key in the server's environment settings. Never put it in code that is committed, in a web page, or in chat.
