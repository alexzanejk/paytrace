# PayTrace, A to Z

**Who this is for:** the team building the connected platform around PayTrace. After reading it you should know what PayTrace is, what it does and does not do, how every piece works, how to connect to it, what is proven and what is not.
**State described:** 25 Oct 2026. Where a feature is waiting to be released it says so ("not merged yet").
**Rule for everyone:** this document contains no secrets and must never get any. Keys, passwords and signing files live only in Supabase, GitHub and the owner's own computer.

---

## 1. One-minute summary

PayTrace **verifies mobile-wallet payments in Bangladesh automatically**. Money arrives in bKash, Nagad, Rocket or Upay accounts; each provider sends an **SMS** for it. PayTrace reads those SMS on dedicated Android phones, sends them to a server, **parses them, stores them, and matches them to customer orders**, so a website can say "paid" without a human checking a phone. It never credits one payment twice.

Around that core it also gives the owner:
- an **admin dashboard** (totals, transactions, review queue, phones, websites, jobs, commission, logs);
- a **deposit gateway**: a website creates an order through an API, the customer pays a wallet number and pastes the TrxID, PayTrace confirms and calls the website back with a signed webhook;
- a **transaction-check API**: "did this transaction ID really arrive?";
- **partner features** for people who lend their agent or personal accounts: commission bookkeeping, "jobs" when a wallet balance gets high, a sent-money check, and an earnings screen in the phone app.

**PayTrace never moves money.** It only reads messages and keeps records. Everyone who sends or receives money does that in the wallet apps, outside PayTrace.

---

## 2. The three connection points (how a connected platform plugs in)

```
                         Wallet providers (bKash / Nagad / Rocket / Upay)
                                      | send an SMS for every transaction
                                      v
   PHONES (Android app)  --raw SMS + heartbeat-->  SUPABASE  (database + 3 edge functions)
   - run all day, screen off               ingest              <----- admin dashboard (React, Cloudflare)
   - partner sees jobs + earnings          gateway   <--API--  WEBSITES (the owner's own sites)
                                           verify-transaction  <--API--  website admin servers
                                                |
                                                +--signed webhook--> website result address
```

| # | Connection point | Who calls whom | Auth | Use it for |
|---|---|---|---|---|
| A | **ingest** (`/functions/v1/ingest`) | Phone app -> PayTrace | Per-phone key (`Authorization: Device <key>`), approved by the owner | Sending SMS, heartbeats, jobs, earnings. Only the PayTrace app talks to it. |
| B | **gateway** (`/functions/v1/gateway/...`) | Your website server -> PayTrace, and PayTrace -> your server (webhook) | Per-website API key (`Authorization: Bearer ptk_...`), webhook signed with HMAC | Creating deposit orders and learning that they were paid. |
| C | **verify-transaction** (`/functions/v1/verify-transaction`) | Your server -> PayTrace | The same kind of `ptk_` key | "Is this TrxID real, and for how much?" |

The dashboard is the owner's control panel on top of the same database. It is not an integration surface.

Base address of the Supabase project (project ref `mkjcqwkfbamnuibmurcd`, region Tokyo): `https://mkjcqwkfbamnuibmurcd.supabase.co`. Dashboard address: `https://paytrace.ashkawser54.workers.dev` (customer pay page at `/pay/`, public partner guide at `/docs/`).

---

## 3. Where everything lives

| Part | What / where |
|---|---|
| Source of truth | GitHub `alexzanejk/paytrace`, branch `main`. The repository is **public**. |
| Database + API | Supabase project `paytrace-payments` (Postgres, Row Level Security, three Edge Functions written in Deno/TypeScript, a `pg_cron` scheduler). |
| Dashboard | `dashboard/` (React + TypeScript + Vite, Tailwind CSS v4, shadcn/ui-style components, Lucide icons). Built to `dist/`, served by Cloudflare Workers static assets (worker `paytrace-dashboard`, build `npm ci && npm run build`). |
| Phone app | `android/` (Kotlin, Jetpack Compose, Material 3, SQLite, WorkManager). Built by GitHub Actions into a signed APK (artifact `paytrace-apk`). Installed by hand (sideload); the Play Store does not allow SMS-reading apps. |
| Edge functions | `supabase/functions/ingest/`, `gateway/`, `verify-transaction/`. Deployed manually (no auto-deploy); the repo must equal the deployed code. |
| Database history | `supabase/migrations/` (26 files, apply in filename order). |
| Tests | `tests/*.test.ts` (run all with `npm test`), plus JUnit tests in `android/app/src/test`. |
| CI | `.github/workflows/ci.yml` (tests, dashboard build, type-check of the functions) and `android.yml` (signed APK). Both run on every push. |
| Docs | `CLAUDE.md` (full engineering notes), `docs/owner-setup.md` (owner's plain-language setup), `docs/gateway-api.md`, `docs/verify-api.md`, `docs/guide-bangla.md`, and this file. |

---

## 4. Vocabulary

- **Provider**: bKash, Nagad, Rocket or Upay.
- **TrxID / TxnID**: the transaction ID printed in the provider's SMS. Unique per provider.
- **Payment**: one stored provider SMS (a row in `payments`).
- **Order**: something a customer should pay for (a row in `orders`). Manual orders come from the dashboard; **deposit** orders come from the gateway API.
- **Claim**: a customer saying "this TrxID is my payment for this order". The server checks it against the stored payment.
- **Device / phone**: an approved Android phone running the app. One phone can hold several provider accounts.
- **Wallet / wallet number**: the account number customers pay. Each phone can have one number per provider and way of paying (**Send Money** or **Cash Out**).
- **Agent**: in this system, one provider wallet on one phone (for example "Karim's Nagad"). Used by jobs.
- **Cash Out receipt**: the SMS an *agent* account gets when a customer withdraws cash at that agent. Money arrives in the agent's e-money balance, so it is a valid incoming payment for a Cash Out wallet.
- **Balance chain**: every provider SMS prints the account's running balance. Real messages therefore form a chain that a forger cannot predict.
- **Partner**: a person who provides a bKash/Nagad/Rocket/Upay agent or personal account (via a phone) and earns a percentage of the daily total through it.
- **Job**: a task shown on a partner's phone when a wallet balance reaches the owner's threshold (default Tk 10,000): "send this money to this wallet address".
- **Owner / admin**: the one person who controls the dashboard.

---

## 5. Life of a payment, step by step

1. A customer pays a wallet number in bKash/Nagad/Rocket/Upay. The provider sends an SMS to the phone that owns that number.
2. The phone app receives it **even with the screen off** (an Android SMS receiver, plus an always-on service). It only forwards messages whose **sender ID** is `bkash`, `nagad`, `16216` (Rocket) or `upay`, so a look-alike text from a normal number never leaves the phone.
3. The app saves the message locally and sends the **raw text + sender ID** to `ingest` (it retries until the server accepts it).
4. The server **parses** the text (so wording fixes need no app update), checks the sender ID again, checks the **balance chain**, assigns a status and **stores it**. `unique(provider, trx_id)` makes a duplicate impossible.
5. If a customer has already **claimed** that TrxID for an order, the server runs the matching function straight away. Otherwise the payment waits as `unmatched`.
6. The customer (on the pay page, or through the website) submits the TrxID. The server runs `claim_order`: same provider, exact amount, order not expired, payment not already used, arrived on the right phone... then the order becomes **paid**.
7. Anything doubtful goes to **review** instead of being credited; the owner decides.
8. For deposit orders PayTrace sends a **signed webhook** to the website and redirects the customer back.
9. The owner is told on **Telegram** (if set up) when a payment is held for review.

**One rule underneath everything:** all crediting goes through `claim_order` / `reconcile_payment` / `manual_match` (advisory lock per TrxID, one payment per order, one order per payment, enforced by unique indexes). Nothing else may credit an order. `manual_match` is the only manual path and is admin-only.

---

## 6. What the parser understands

| Provider | Sender ID | Recognised layouts | Status of the layouts |
|---|---|---|---|
| bKash | `bkash` | Cash Out (agent), payment received, send money received | **Cash Out confirmed with real messages.** Received / Send Money layouts were written from general knowledge, **not yet confirmed with real samples**. |
| Nagad | `nagad` | Cash Out, payment received, money received | **Cash Out confirmed with real messages.** Others unconfirmed. |
| Rocket | `16216` | Agent Cash-Out ("B2C: Cash-Out from A/C ... TxnId ...") | Confirmed. Every other Rocket layout uses the generic parser and is **held for review** (`unverified_format`). |
| Upay | `upay` | none confirmed | Everything uses the generic parser and is **held for review**. |

Fields extracted: type, TrxID, amount, fee, commission, balance after, counterparty, time (read as Bangladesh time, +06:00). Messages that look like failures, reversals, refunds or OTPs are ignored and logged. Nagad and Rocket state the agent **commission**; bKash does not, so it is **recovered from the balance chain** (balance rise minus amount) and stored only when the chain checks out. Measured on real messages: bKash 0.40%, Nagad 0.41%, Rocket 0.42%.

---

## 7. Statuses and rules

**Payment status**
- `unmatched` - stored, waiting for an order to claim it.
- `matched` - used to pay an order.
- `review` - held for a person; never credited.
- `tracked_only` - agent **Cash Out** receipts: recorded and counted in totals, but **cannot credit an order** unless an order whose wallet is a Cash Out wallet claims it.
- `ignored` - the owner dismissed it.

Money totals everywhere count only `unmatched`, `matched` and `tracked_only`. Held or ignored payments are never in the totals. A "day" is **12:00 AM to 11:59 PM Asia/Dhaka**.

**Order status:** `pending`, `paid`, `review`, `expired`, `cancelled`.

**Held for review (never auto-credited) when:** the amount differs from the order; the payer's phone digits differ; the order had already expired; the payment arrived on a **different phone** than the number shown to the customer (`wrong_phone`); the layout is not a confirmed one; the balance chain is broken for something that could credit an order; for Cash Out receipts, the chain is `mismatch`. A Cash Out receipt can **never** pay an order whose wallet is Send Money. A claim allows **5 attempts per order** (stops TrxID guessing). A claimed order gets **10 extra minutes** for a late SMS.

---

## 8. Fake-SMS defence (three layers, and the honest hole)

1. **Phone filter:** only the four provider sender IDs are forwarded.
2. **Server check:** the sender ID is re-checked and is **required** (a payload without one is rejected with 403).
3. **Balance chain:** each real SMS states the running balance; a forged one cannot know it. A broken chain **holds** any payment that could credit an order. (Agent balances also move through cash-in, send money and bill pay, which produce no stored message, so Cash Out receipts with a broken chain are marked `mismatch` and left `tracked_only` instead of flooding review.)

**The remaining hole:** alphanumeric sender-ID spoofing cannot be fixed by reading text. The balance chain is the mitigation; a provider API would be the real fix. Also: SMS can be delayed or missed, so the app re-reads the phone's inbox to recover missed messages (section 10).

---

## 9. Phones, in depth

**Pairing (no secret typed anywhere).** The app has the ingest URL built in, makes its own random key, sends only the key's **SHA-256 hash**, and shows a short code like `3F9A-01BC`. The owner approves that code in the dashboard's Phones page. From then on the app sends `Authorization: Device <key>`; the server stores only the hash. Each phone can be removed on its own. At most 10 pending pairing requests per hour. (A shared `INGEST_SECRET` is still accepted as an optional fallback in Settings > Advanced; it is never built into the APK.)

**Heartbeat.** An always-on foreground service sends `{"action":"heartbeat"}` every **30 seconds**: battery, monitoring on/off, SMS and inbox permission, notification permission, battery-optimisation state, setup complete, waiting/failed message counts, app version, wake-push state, the result of the screen-off test. Any authenticated request also refreshes `last_seen_at`. The dashboard shows **Online / Offline** (offline after **90 s** of silence) and a red banner on every page. The reply to a heartbeat also carries the phone's open **jobs** (so the job alarm costs no extra requests).

**Staying alive (the hard part).** Phone makers (Vivo, OnePlus, Oppo, Xiaomi, Samsung and others) kill background apps. On 16 to 17 Oct 2026 a Vivo killed the service outright and a OnePlus froze it with the screen off. Mitigations built in:
- always-on foreground service with a CPU wake lock and Wi-Fi lock;
- keep-alive alarms (45 s quick alarm, 5-minute alarm-clock backup, 5 s restart when the app is told it is stopping);
- a 15-minute WorkManager safety net (inbox catch-up, heartbeat, restart attempt);
- restart after reboot and app update;
- optional **SMS app mode** (becoming the default messaging app, which brands almost never kill; also a basic SMS client, no MMS);
- **send on reconnect** (waiting messages go the moment the internet is validated);
- **Firebase wake-up push**: the every-minute server watchdog sends a high-priority FCM message to phones quiet for 100 s (at most once per 10 min per phone). Needs the owner's Firebase service-account secret; without it nothing is sent.
- **Phone-settings guide** in the app (Bangla first, English switch): per brand, the exact settings to change, an Open button that tries several settings pages and says which opened, a Phone check (what Android reports), and a **10-minute screen-off test** whose result is shown on the dashboard.
- "stopped by the phone" detection: a 5+ minute gap while the phone stayed on is counted and shown.

It cannot be made 100% in software. "Offline" is inferred from silence: a dead battery, no internet and a killed app look the same.

**Inbox catch-up.** The SMS stays in the phone's inbox even if the live listener missed it. The app reads the inbox on every heartbeat cycle, at app open and after boot, and stores any provider message not already stored (oldest first so the balance chain works; first scan looks back 24 h, never more than 7 days). The server dedupes by TrxID, so sending twice is harmless.

**Required permissions gate.** The app will not run until it has: receive SMS, read SMS, notifications, battery-optimisation exemption, and (for the makers above) every guide step done. It re-checks every 2 s, so it unlocks as soon as the owner returns from Settings.

---

## 10. Alerts and the watchdog

- A `pg_cron` job (`paytrace-watchdog`) calls the ingest `watchdog` action **every minute**. It needs no secret: it returns nothing and only acts on real timestamps.
- A phone silent for **3 minutes** triggers **one** Telegram alert ("phone is offline"); a "back online" message follows when it speaks again.
- A payment held for review triggers a Telegram message. Also: SMS permission off or monitoring off.
- Telegram text is plain (no formatting), built from our own wording; anything from outside is cleaned. Sending never blocks saving a payment and never logs the bot token.
- Everything works without Telegram; alerts are simply off. **Status: the owner has not yet created the bot**, so no real Telegram message has ever been sent.
- The dashboard's "Send a test message" and "Test wake-up" buttons call ingest from the browser with the admin's own login token (CORS allows only the dashboard's own address).

---

## 11. The dashboard (owner's control panel)

Light theme by default with a dark switch; left menu on wide screens, top menu on phones. Pages:

| Page | What it does |
|---|---|
| **Overview** | Period + phone filter; bright tiles (received, agent cash out, commission, needs review, unmatched); "Money by day" bars; "Share by wallet" ring; last known balance per provider; by-phone table; breakdown. |
| **Transactions** | Every stored payment with filters (period, phone, provider, type, status, TrxID/number search), totals strip, expandable rows with the raw SMS as plain text, CSV download (formula-safe), 100 at a time. |
| **Review** | Payments held for a person; approve (match to an order) or ignore. |
| **Orders** | Manual orders and website deposit orders (Source column). |
| **Commission** | Per-partner earned / paid / owed, day by day, payouts, CSV. |
| **Phones** | One card per phone: rename, health, battery, version, day totals per provider, last balance, **Deposit numbers**, **Partner commission** (rates, "show in app" switch), wake-up and screen-off test status, remove. New phones wait here for approval. |
| **Jobs** | Write the default job and per-agent overrides; see jobs showing now; **Sent-money checks** table (Accept/Reject). |
| **Websites** | One card per website API key: result address (webhook) + signing secret shown once, result page look, landing pages, developer brief, revoke. Link to the public partner guide. Optional transaction-check API section. |
| **Activity log** | The events table: created, duplicate, ignored, parse failures, rejected sender, phone silent/recovered, job events. |
| **Settings** | Provider on/off, Telegram test, two-step login setup. |

SMS text is treated as untrusted: the dashboard renders it only as plain React text, never HTML.

---

## 12. The deposit gateway (for websites)

**Purpose:** a website lets customers deposit money into the owner's wallets and learns automatically when the money arrived. Only the owner's own sites (one API key per site; no multi-merchant accounts).

**Keys.** Made on the Websites page: `ptk_` + 64 hex characters, **shown once**, only the SHA-256 hash is stored, at most 20 active, revocable. Keep it in the server's environment; never in a browser.

**Flow**
1. The website lets the customer pick provider and method (Send Money or Cash Out) on **its own page**. PayTrace's page starts after that choice.
2. The website's server calls `POST /functions/v1/gateway/create-deposit` with `Authorization: Bearer ptk_...` and body
   `{"amount":500,"order_id":"SHOP-1001","provider":"nagad","method":"cash_out","return_url":"https://..."}`
   (`provider` required; `method`, `return_url` optional). It returns a `pay_url`. The same `order_id` returns the same order (safe retry). A wallet number is assigned now (approved phones that have a number for that provider and method; online first, then least recently handed out); with none set up the call fails with `409 no_wallet`.
3. The customer opens `pay_url` (`/pay/?trackingNumber=...`): Bangla by default, English toggle; provider banner, the wallet number, a countdown, the TrxID box. They pay, copy the TrxID from the SMS and paste it.
4. The server runs `claim_order`. If the SMS has not arrived yet, the page keeps checking every 4 s.
5. On **paid**, **held**, **expired** or **cancelled**, PayTrace sends a **signed webhook** and redirects the customer (`return_url` wins, else the site's configured success/failure page).

**Other routes:** `order-status` (website asks the state of an order), `pay-order`, `pay-pick`, `pay-submit` (used by the pay page; callable from a browser only from the dashboard's own address), `deliver` (internal; a cron job calls it every minute to send waiting webhooks and expire unpaid orders).

**Webhook:** `POST` JSON `{"event":"deposit.paid","data":{"tracking_number","order_id","status","amount","currency","provider","trx_id","paid_at"}}`. Events: `deposit.paid`, `deposit.review`, `deposit.expired`, `deposit.cancelled`. Header `X-Webhook-Signature: t=<unix seconds>,v1=<hex>`, where `v1` = HMAC-SHA256 of `"<t>.<raw body>"` with the key's signing secret. Also `X-Webhook-Event`, user-agent `Deposit-Webhook/1`. Reply any 2xx. Retries: 1 min, 5 min, 15 min, 1 h, 3 h, 6 h, 12 h (8 tries). A message can arrive twice: handle by `order_id`.
**The website must credit only on `status: "paid"` from the webhook or `order-status`, never because the browser was redirected.**

**Limits:** amount **500 to 50,000 Tk** (2 decimals max); expiry 3 to 60 min (default 15); 5 TrxID attempts per order; 120 API calls per minute per key.

**Embedding / white label.** The pay page has no PayTrace branding and can be shown in an `<iframe>` (framing allowed from any https page; the dashboard itself can never be framed). Framed pages tell the parent with `postMessage` (`{source:"deposit-page", type:"height"|"state"|"redirect"}`, no secrets). The public guide at `/docs/` has copy-paste code, loading animations for the site's own "Next" button, and a full-screen recipe. Still visible in browser dev tools: the frame's address (`workers.dev`) and the Supabase address; hiding them needs a custom domain (costs money) and a proxy. **Not yet verified on the live Cloudflare site.**

**Result screens:** after the customer presses Confirm, the waiting/paid/held/expired screens come in six looks (Aurora, Steps, Receipt, Checklist, Ring, Playful), chosen per key (or automatic), so different sites do not look identical.

**Not built:** withdrawals (plan: a request queue the owner pays by hand and records, webhook `withdrawal.paid`; providers give no way to send money from an app), and a customer-side "cancel order" button.

---

## 13. The transaction-check API

`POST /functions/v1/verify-transaction` with `Authorization: Bearer ptk_...` and `{"transaction_id":"EXAMPLE123","provider":"bkash","amount":500}` (`provider` and `amount` optional; spaces and case are tidied).

| Case | HTTP | Body |
|---|---|---|
| Found | 200 | `{"found":true,"provider":"bkash","amount":500,"currency":"BDT","amount_matches":true}` (`amount_matches` only if you sent `amount`) |
| Not found | 200 | `{"found":false}` |
| Same ID on two providers, no `provider` sent | 200 | `{"found":true,"ambiguous":true,...}` |
| Bad/revoked key | 401 | `{"error":"unauthorized"}` |
| Bad request | 400 | `{"error":"..."}` |
| Over 60 lookups/min/key | 429 | retry later |

Anything other than 200 must be shown as **Pending check** and retried, never as "Unverified". "Found" means a stored payment, send-money receipt **or** agent cash-out receipt with status `unmatched`, `matched` or `tracked_only`. **Held (`review`) and `ignored` are NOT found, on purpose** (a held one could be a fake SMS). The response deliberately contains only provider and amount, never phone numbers, balances or message text. Call it from servers only.

---

## 14. Partner commission and the earnings screen

People who provide agent (Cash Out) or personal (Send Money) accounts through their phone earn a **percentage of the daily total** that comes through that phone.

- The owner sets **rates per phone x provider x kind** (`cash_out` or `send_money`; `payment_received` and `unknown` earn nothing). Rates are **effective-dated**: a new rate applies from its start date, earlier days keep their rate.
- Commission counts payments with status `unmatched`/`matched`/`tracked_only`; a held payment earns nothing until approved.
- The owner **records payouts** (paid outside PayTrace); a wrong entry is voided, never deleted. **PayTrace never pays anyone.**
- **Due to the partner = everything earned - everything paid.**
- A phone's app shows earnings **only if the owner switched "show in app" on for that phone** (default off). The app then shows: Due to you, earned/paid in total, today, this month (day 1 to the last day, day by day), and **only the payments of the last 3 days** (the owner's rule).
- Not built on purpose: partner web logins, a public recruiting page, income claims, security deposits, USDT/conversion flows.

---

## 15. Jobs, the job alarm and the sent-money check

**Why:** when an agent wallet's balance gets high (default **Tk 10,000**), the owner wants the money moved out to the owner's crypto wallet.

- The owner writes **one default job** (amount, instruction with `{agent}`, `{provider}`, `{balance}` placeholders, urgency Normal/Urgent/Critical, wallet address) and may override name, instruction, urgency, wallet or switch off **per agent** (an agent = one provider wallet on one phone). The wallet is the owner's **Trust Wallet on BNB Smart Chain (BEP20)**; an address starting `0x` must be exactly 0x + 40 hex characters (checked in the dashboard and the database); the phone card warns to send only on that network. Two agents of the same provider on one phone cannot be told apart (the SMS does not name the account), so they share one balance.
- A job shows on the phone while the wallet's **newest printed balance** is at or above the amount and no send is pending since that balance.
- **Job alarm:** when a job first appears the phone plays an alarm-stream sound and vibrates for **20 seconds** and shows a notification (even with the app closed); repeats every **10 minutes** while the job stays open. It rides on the 30-second heartbeat reply, so it costs no extra requests. Settings has a switch and a Test button.
- **Sent-money check.** Sending money out leaves **no SMS**, so PayTrace cannot see it. The partner taps **I sent it** and types the exact amount sent and the P2P charge. PayTrace remembers the wallet's last balance and checks it against the **next Cash Out SMS** for that wallet: `balance in that SMS - cash-out amount - commission` must equal `old balance - amount sent - charge`.
  - Nagad and Rocket print commission, so the match is exact to the paisa. bKash does not, so the leftover must look like a normal commission (0.30% to 0.60% of the cash-out, +/- 0.50): **a small typing slip on bKash can pass.**
  - Match = **Verified**. Miss = the partner may **fix the numbers once**; a second miss goes to the owner (**Review**), who can **Accept** or **Reject** (with a note) on the Jobs page.
  - Known gap: a cash-out SMS that arrives between the real send and the partner's submit makes the baseline too new, so the send shows red; the one correction or the owner's Accept covers it.
  - It proves the money **left** the wallet, not that it **reached** the owner's crypto wallet; the owner compares with the wallet history.
- The phone shows the last 3 days of sends as small rows: Verified, Waiting, Check, With owner, Rejected (with the owner's note).

---

## 16. The phone app, screen by screen

Dark look by default (switch in Settings), dashboard blue, Bangla settings guide.

- **Home:** greeting + status pill (Running / Not connected / Needs attention); the blue **balance card** (Due to you, earned and paid in total, Today, This month, Paid in 3 days; if earnings are off for the phone it says so); **Paid to you, last 3 days**; **Jobs** (job cards with instruction, wallet address with Copy, network warning, **I sent it**); **Your sends, last 3 days**; pairing card, permission warnings, SMS-app banner.
- **Earnings** (only when switched on): due hero, today / this month, last-3-days payments, the month day by day, how it is worked out.
- **Messages:** a basic SMS client (works fully only when PayTrace is the default SMS app; no MMS).
- **Settings:** dark look, job sound + test, SMS app mode, extra-strong keep-alive, the settings guide ("Keep this phone running"), Advanced (server address, optional secret).
- When the app is in the background only the service works; the screen's own timers stop.
- Bangla applies to the settings guide only; the rest of the app is English (job card title is Bangla).

---

## 17. Security model

- **Secrets never in the repo.** The repository is public. Secrets live only in Supabase Edge Function secrets (`INGEST_SECRET` optional, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `FIREBASE_SERVICE_ACCOUNT`, optional `DASHBOARD_URL`) and GitHub Actions secrets (`ANDROID_KEYSTORE_BASE64` and its three companions, optional `GOOGLE_SERVICES_JSON`). The owner sets them in private prompts; the assistant never sees values.
- **Row Level Security** on tables; admin-only RPCs check `is_admin()`; sensitive functions (`gw_*`, `device_*`) are service-role only; views are `security_invoker`.
- **Admin login:** one Supabase Auth user listed in `public.admins`. Public sign-ups should be OFF. **Two-step login (authenticator app / TOTP) is enforced in the database**: once the admin has a *verified* factor, `is_admin()` requires an `aal2` session; before that nothing changes (lockout-safe). Not yet enrolled by the owner against real Supabase Auth.
- **Keys:** phone keys and website keys are stored only as SHA-256 hashes; compared in constant time; website keys rate-limited.
- **CORS:** ingest and gateway pay routes answer browsers only for the dashboard's own origin, never `*`.
- **Untrusted input:** SMS text is never rendered as HTML.
- **Leaked-password protection** is a Supabase Pro feature and is **not on**.
- A `npm audit` note: `@supabase/auth-js` has a low advisory that is not reachable here; **do not bump `@supabase/supabase-js` blindly** (two-step setup depends on the QR-code format).

---

## 18. Data model (what exists)

Tables: `admins`, `settings`, `payments`, `orders`, `events`, `devices`, `device_push`, `device_wallets`, `webhook_outbox`, `api_keys`, `verify_rate`, `commission_rates`, `commission_payouts`, `job_settings`, `agent_jobs`, `job_completions`, `job_transfers`.
Views: `payment_totals`, `device_day_totals`, `device_balances`, `provider_balances`, `device_commission_daily`, `device_commission_balance`, `device_open_jobs`.
Key functions: `reconcile_payment`, `claim_order`, `manual_match`, `balance_chain_check`, `is_admin`, `verify_transaction`, `gw_*` (gateway), `device_earnings`, `device_jobs`, `device_job_sent`, `device_job_fix`, `device_job_done`, `resolve_job_transfer`, `set_commission_rates`, `add_commission_payout`, `void_commission_payout`, `set_job_settings`, `set_agent_job`, `create_api_key`, `revoke_api_key`, `rename_device`, `set_device_status`.
A trigger on `payments` judges waiting sent-money checks and swallows every error, so it can never stop a payment from being saved.
Cron jobs: `paytrace-watchdog` (every minute), `paytrace-gateway-deliver` (every minute).

---

## 19. Operating it

- **Deploy:** push to GitHub -> CI runs; Cloudflare builds the dashboard from `main` (sometimes needs "Retry build"); edge functions are deployed by hand and the repo must match; database changes are applied as migrations in order.
- **Phones:** GitHub -> Actions -> "Build Android APK" -> artifact `paytrace-apk`. Install on each phone; the app asks for permissions and the settings guide, then shows a pairing code to approve in the dashboard.
- **Signing key:** the permanent Android signing key is created on the owner's own computer (`scripts/create-android-key.sh`) and stored as GitHub secrets; **the owner has not done this yet**, so builds are currently signed with a throwaway key (the run summary says so). The key's fingerprint must never change between builds.
- **Cost:** everything runs on free plans. Each phone's 30-second heartbeat costs about 87,000 function calls a month; three phones plus the watchdog is about 300,000 of the free plan's 500,000, so **about five phones is the ceiling** before Supabase Pro ($25/month). Ask the owner before spending anything (Pro, a custom domain, a spare phone).
- **Time:** everything is Bangladesh time for people; the database stores real timestamps.

---

## 20. Tests

`npm test` runs 12 files (parser against real messages, notification wording, phone health, watchdog, wake logic, dashboard thresholds, period/day maths, verify-API logic, gateway logic, loaders, commission, jobs and migration structure). JUnit tests in the Android project cover the inbox catch-up, setup gate, vendor pages, heartbeat parsing, job parsing and alarm policy, earnings parsing, the sent-money input, the screen-off test and the Bangla guide text. The dashboard and the database rules have also been driven in a real browser against a simulated Supabase and in rolled-back live SQL runs.

---

## 21. What is proven, and what is not (be honest with each other)

**Proven live (16 Oct 2026):** dashboard live; pairing end to end on a OnePlus; three real Nagad cash-out receipts captured, parsed and reconciled; the endpoint answers 401 to unknown phones, no credentials and garbage tokens; the watchdog runs through pg_cron; the two-step rule works in the database; the gateway and jobs rules ran in rolled-back live tests; function endpoints answer correctly.

**Not yet verified on real devices or real money:**
- **Every Android screen added since 18 Oct** (heartbeat service in the wild over many hours and across reboot, setup gate, job alarm and its volume, Do-Not-Disturb behaviour, the new Home/Earnings screens, the settings guide, the screen-off test, the Bangla text, SMS app mode) has only been **compiled and unit-tested by CI**, never run on a phone.
- **A real order paid with real money end to end, and a real webhook to a real site.** No payment has ever been matched to an order; only cash-out receipts have been seen.
- bKash and Nagad **received / Send Money** layouts and everything for **Upay** and non-agent **Rocket**: unconfirmed (held for review).
- Telegram has never sent a message (no bot yet). Firebase wake-ups: not live until the owner sets the service-account secret and builds with Firebase config.
- The two-step login against real Supabase Auth; the permanent signing key; the iframe/white-label headers on the live Cloudflare site.
- Brand settings pages in the guide that came from public lists (not ZiniPay's) are unverified; a missing one is skipped.
- The Bangla guide text has not been proofread by a Bangla speaker.

**Release state (25 Oct 2026):** `main` contains everything up to the screen-timer change. The **rebuilt settings guide + screen-off test + Bangla guide** are on branch `claude/serene-thompson-dlp9aw`, built and tested by CI, **waiting for the owner's "merge"** (the server side, ingest v21, is already live). Phones are on older app versions until the new APK is installed.

**Phones on the account (24 Oct):** three approved - a Vivo V2120, a Xiaomi 22101316I and a OnePlus LE2111. Earnings are switched on only for the Vivo.

---

## 22. Limits to repeat to everyone (including customers' stakeholders)

- Reading wallet SMS is an **unofficial** approach and **may breach provider terms**; wallets could be frozen. Official aggregators (for example SSLCOMMERZ) are the safer long-term route.
- SMS can be **spoofed** (sender ID) or **delayed**; the balance chain is a mitigation, not a guarantee.
- The phones **must stay on, charged, connected and unrestricted**; Android brands fight this.
- The app is **sideload-only** (Play Store forbids SMS-reading apps).
- PayTrace **records**; it never pays, sends or withdraws. Withdrawals would be a manual queue.
- Cash-in, send-money and bill-pay on an agent account leave no SMS, so the agent balance can drift between messages.

---

## 23. For the connected platform: decisions and checklist

When you wire another platform to PayTrace, settle these first:

1. **Who creates orders?** Use `create-deposit` for customer deposits (idempotent by `order_id`). Do not insert orders any other way.
2. **Who is the source of truth for "paid"?** PayTrace. Credit only on the signed `deposit.paid` webhook (or `order-status`), verify the signature, answer 2xx, and make the handler idempotent by `order_id`.
3. **Plan for review.** `deposit.review` means a human at PayTrace must decide; show "under review", do not credit.
4. **Plan for waiting and expiry.** Orders expire (default 15 min) and an SMS can arrive late; a late payment may land in review.
5. **Keys:** one key per website/server, in environment settings only; rotate by revoking in the dashboard. Treat the key like a password.
6. **Amounts:** 500 to 50,000 Tk, two decimals; amount must match exactly or the payment is held.
7. **Wallet numbers** must be set up on the Phones page (per provider and method) before orders can be created; otherwise `409 no_wallet`.
8. **If your platform needs more data from PayTrace** (for example transaction lists, balances, partner earnings), there is **no public API for it today**; those live behind the admin dashboard. Ask the owner; adding an endpoint means a new key scope and rate limit.
9. **Time zones:** show Bangladesh time to people; store UTC.
10. **Errors:** non-200 from `verify-transaction` = "pending check, retry", never "unverified".

---

## 24. FAQ

- **Does PayTrace need the wallet apps' passwords?** No. It only reads the SMS.
- **Can it double-credit?** Not through the matching path: one payment per order and one order per payment are enforced by unique indexes and a lock per TrxID.
- **What if the phone is off?** Payments wait; the app recovers the missed SMS from the inbox when the phone is back (up to 7 days). The owner is alerted after 3 minutes of silence if Telegram is set up.
- **Why are some payments in Review?** Wrong amount, expired order, wrong phone, unconfirmed message layout, or a broken balance chain. The owner decides.
- **Can customers see "PayTrace"?** The pay page carries no brand text and can sit in an iframe on the website. The address in dev tools still shows `workers.dev` until a custom domain is bought.
- **Which languages?** Pay page: Bangla default + English. Phone settings guide: Bangla default + English. Dashboard and the rest of the app: English.
- **Where do I read the code-level rules?** `CLAUDE.md` in the repository (long, exact, written for engineers and updated with every change).
