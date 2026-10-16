# Transaction check API (for the website's admin and super-admin servers)

Ask PayTrace: **"did this transaction ID really arrive in our payment account?"** It answers only `true` or `false`.
It is read-only and never returns amounts, phone numbers or any other detail.

Call it **from your servers only**, never from a browser or app a customer can open: the key would be visible.

## Request

```
POST https://mkjcqwkfbamnuibmurcd.supabase.co/functions/v1/verify-transaction
Authorization: Bearer <your key>
Content-Type: application/json

{"transaction_id": "EXAMPLE123"}
```

Optional: `"provider": "bkash" | "nagad" | "rocket" | "upay"` to look only at one provider. Without it, all four are searched.
Spaces and lower case are tidied for you (`" bk12ab34cd "` is looked up as `BK12AB34CD`).

## Response

| What happened | HTTP | Body | Show on the card |
|---|---|---|---|
| Exact ID found | 200 | `{"found": true}` | **Verified** |
| Not found (or not a possible ID) | 200 | `{"found": false}` | **Unverified** |
| Wrong or missing key | 401 | `{"error": "unauthorized"}` | fix the key |
| Bad request (not JSON, no `transaction_id`, unknown provider) | 400 | `{"error": "..."}` | fix the request |
| Too many lookups (60 per minute per key) | 429 | `{"error": "..."}` | **Pending check**, retry after 60 s |
| Server trouble or timeout | 500 / 503 / no answer | | **Pending check**, retry |

Anything other than a 200 must show **Pending check** and be retried, never "Unverified": a customer who really paid
must not be marked unpaid because of a network problem. Use a timeout of about 5 seconds.

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
async function verifyTransaction(id) {
  try {
    const res = await fetch(
      "https://mkjcqwkfbamnuibmurcd.supabase.co/functions/v1/verify-transaction",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.PAYTRACE_VERIFY_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ transaction_id: id }),
        signal: AbortSignal.timeout(5000),
      },
    );
    if (res.status !== 200) return "pending";
    return (await res.json()).found === true ? "verified" : "unverified";
  } catch {
    return "pending";
  }
}
```

```
curl -X POST https://mkjcqwkfbamnuibmurcd.supabase.co/functions/v1/verify-transaction \
  -H "Authorization: Bearer $PAYTRACE_VERIFY_KEY" -H "Content-Type: application/json" \
  -d '{"transaction_id":"EXAMPLE123"}'
```

Keep the key in the server's environment settings. Never put it in code that is committed, in a web page, or in chat.
