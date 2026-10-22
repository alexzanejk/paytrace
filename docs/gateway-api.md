# PayTrace deposit gateway

For the owner's own websites. A website's server creates a **deposit order**, sends the customer to a PayTrace **pay page**, and
PayTrace tells the website when the order is **paid**. The customer pays one of your phones' wallet numbers and enters the
transaction ID (TrxID); PayTrace matches it with the SMS the phone already captured. Nothing is credited without a matching,
unused message for exactly that amount.

The text a developer needs is on the dashboard's **API access** page ("Copy deposit instructions for the developer"). It is
generated from `dashboard/src/lib/apiDocs.ts` (`depositInstructions`), which is the reference for the exact fields.

## The flow

1. Website server: `POST {SUPABASE}/functions/v1/gateway/create-deposit` with `Authorization: Bearer ptk_...` and
   `{"amount":500,"order_id":"SHOP-1001","provider":"nagad","method":"cash_out","return_url":"https://..."}` (`provider` required,
   `method` and `return_url` optional). The website's own page lets the customer choose the method ("Bkash Send Money", "Nagad Cash Out"...);
   PayTrace's page starts after that choice. The wallet number is assigned at creation; with no number set up for that provider/method the
   call fails with 409 `no_wallet`. Returns `pay_url`. The same `order_id` returns the same order, so a retry is safe.
2. Customer opens `pay_url` (`/pay?trackingNumber=...` on the dashboard's address). The page is Bangla by default with an
   English toggle and starts at the payment step: provider banner with logo, the wallet number (an approved phone that has a number for
   that provider and method; online phones first, then the one handed out least recently), a countdown and the TrxID box.
3. Customer pays the number, copies the TrxID from the SMS or receipt and pastes it. The server runs `claim_order`, which uses the
   same atomic, one-payment-per-order path as every other order. If the SMS has not arrived yet the page waits (it checks every 4 s).
4. When the order is paid, held for review, or expires, PayTrace sends a signed **webhook** to the key's result address and the
   customer is redirected to `return_url` after a confirmed payment. The website must only credit on `status: "paid"` from the
   webhook or from `order-status`, never because the browser was redirected.

## Webhook

`POST` JSON `{"event":"deposit.paid","data":{"tracking_number","order_id","status","amount","currency","provider","trx_id","paid_at"}}`.
Events: `deposit.paid`, `deposit.review`, `deposit.expired`, `deposit.cancelled`. Header
`X-PayTrace-Signature: t=<unix seconds>,v1=<hex>` where `v1` is HMAC-SHA256 of `"<t>.<raw body>"` with the key's signing secret
(shown once on the API access page when the address is first saved). Answer any 2xx. Failures are retried 1 min, 5 min, 15 min,
1 h, 3 h, 6 h, 12 h (8 tries). A message can arrive twice; handle by `order_id`.

## Cash Out wallets (agent numbers)

A wallet is either **Send Money** or **Cash Out** (the customer cashes out at the agent number, which is how bKash agent numbers
receive money). A Cash Out receipt can pay an order only if the order's wallet is a Cash Out wallet **and** the balance chain for
that receipt is not `mismatch`; otherwise the order is held in Review and the owner approves it (`manual_match` accepts that pair).
A Cash Out receipt can never pay an order whose wallet is Send Money. Receipts stay `tracked_only` unless an order claims them.

## Held for review

A payment is held (never credited) when the amount differs, it arrived after the order expired, it arrived on a different phone
than the number the customer was shown (`wrong_phone`), the balance chain is broken for a Cash Out receipt, or the layout was
not a recognised one. The owner sees it in Review and can approve it by hand.

## Limits

Orders: amount 10 to 500000 with at most 2 decimals; expiry 3 to 60 minutes (default 15). A claimed order gets 10 extra minutes
for a late SMS. 5 TrxID attempts per order. 120 website API calls per minute per key. Withdrawals are not built yet.
