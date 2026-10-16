# PayTrace: handoff notes for Claude Code

Read this first. It records what exists, why, and what is still open. The owner is non-technical: explain in plain
language, ask before anything that costs money, and never ask for or write secrets in chat or in files.

## What this is
Automatic payment verification for a Bangladesh business using SMS from bKash, Nagad, Rocket and Upay. An Android
app forwards payment SMS to a Supabase endpoint; the server parses them, stores them, and matches them to customer
orders without ever crediting one payment twice. An admin dashboard shows totals, logs, orders and a review queue.
The idea was modelled on the public README at github.com/Mr-SxR/bKash-Nagad-Payment-Auto-Verification, which
contains no source code; everything here was written from scratch.

## Where things live
| Part | Location |
|---|---|
| Source of truth | GitHub `alexzanejk/paytrace`, branch `main` |
| Database + API | Supabase project `paytrace-payments`, ref `mkjcqwkfbamnuibmurcd` (Tokyo, `ap-northeast-1`) |
| Receiving endpoint | `https://mkjcqwkfbamnuibmurcd.supabase.co/functions/v1/ingest` (Edge Function, `verify_jwt=false`, own secret check) |
| Dashboard | React + TypeScript + Vite in `dashboard/` (source in `dashboard/src`), Tailwind CSS v4, shadcn/ui components in `dashboard/src/components/ui`, Lucide icons. `npm run build` → `dist/`. Cloudflare Workers static assets (`wrangler.jsonc`, worker `paytrace-dashboard`, build command `npm ci && npm run build`) |
| Android app | `android/` (Kotlin, Compose, SQLite, WorkManager). GitHub Actions builds a **signed release** APK (artifact `paytrace-apk`, file `paytrace.apk`) |
| Tests | `tests/*.test.ts`, run all with `npm test` (parser, notify wording, phone health, watchdog, dashboard health thresholds) |
| CI | `.github/workflows/ci.yml` (tests + dashboard build + `deno check` of the function) and `android.yml` (signed APK). Both run on every push |
| Owner guide | `docs/owner-setup.md` (plain language: Telegram, signing key, two-step login) |
| DB history | `supabase/migrations/` (apply in filename order) |

Deployed edge function code is `supabase/functions/ingest/{index.ts,parser.ts}`. Redeploy after editing. Keep the repo
and the deployed function identical.

## Secrets (never commit)
- Phones connect by **pairing**, not a shared secret: the app has the ingest URL built in, makes its own random key,
  sends only the key's SHA-256 hash (`action: "pair"`), and shows a code like `3F9A-01BC`. The owner approves that code
  in the dashboard's Devices tab (`set_device_status`). The app then sends `Authorization: Device <key>`; the server
  stores only the hash (`public.devices`). Each phone can be removed on its own. Max 10 pending requests per hour.
- `INGEST_SECRET` (Edge Function secret, set by the owner in Supabase, Claude never sees it) is still accepted as an
  optional fallback under the app's Settings → Advanced. Never build it into the APK: anyone with the APK could extract it.
- **The GitHub repo is PUBLIC.** Never print a secret in a workflow log or commit one. Secrets live only in
  Supabase Edge Function secrets and GitHub Actions secrets.
- Telegram alerts: Edge Function secrets `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (optional `DASHBOARD_URL`). The
  owner sets them (the `create_edge_function_secret` tool opens a prompt where only the owner types the value;
  Claude never sees it). Everything works without them; alerts are simply off.
- Android signing: GitHub Actions secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
  `ANDROID_KEY_PASSWORD`, made on the owner's own computer by `scripts/create-android-key.sh`. Claude cannot set
  GitHub secrets and must never hold the key. Without them CI signs with a throwaway key (it says so in the run
  summary); with them the run summary shows the key fingerprint, which must never change between builds.
- The publishable key in `dashboard/src/lib/supabase.ts` is public by design; RLS protects the data.
- Admin login: one Supabase Auth user, listed in `public.admins`. Public sign-ups should be OFF in Supabase Auth.
- **Two-step login (TOTP) is enforced in the database, lockout-safe.** `is_admin()` requires an `aal2` session only
  once the admin has a *verified* authenticator factor; before that, nothing changes. Recovery if the authenticator is
  lost: `delete from auth.mfa_factors where user_id = '<admin id>';` (SQL editor or MCP).
- Leaked-password protection is a **Pro plan** feature ($25/mo) and is NOT on. Do not describe it as free.

## Frontend stack (fixed)
- Dashboard: React + TypeScript + Vite, Tailwind CSS v4 (`@theme` tokens in `dashboard/src/index.css`, no JS config),
  shadcn/ui-style components copied into `components/ui`, Lucide icons, responsive for desktop and mobile.
- Android: Kotlin + Jetpack Compose + Material 3. (ViewModel/StateFlow and Navigation Compose are the target for new
  screens; the owner chose to leave the existing screens as they are.)
- The two share one palette: the Material 3 baseline colours the Android app uses are the dashboard's CSS tokens, and
  payment-status colours live in one place per app (`components/StatusBadge.tsx` on the web).

## Design decisions
- The phone sends the raw SMS plus sender ID. **The server parses**, so wording fixes never need an app update.
- `payments` has `unique(provider, trx_id)`. Orders: one payment per order, one order per payment, enforced by unique
  indexes. All matching goes through `reconcile_payment` / `claim_order` (advisory lock per TrxID, so races cannot
  double-credit). Do not credit orders any other way. `manual_match` is the only manual path and is admin-only.
- Agent **Cash Out** receipts are stored as `tracked_only` and can never credit an order.
- Amount, fee and commission are separate columns. Nagad and Rocket state commission (`Comm:`); bKash does not, so
  it is recovered from the balance chain (balance rise minus amount) and stored only when the chain checks out.
  Measured from real messages: bKash 0.40%, Nagad 0.41%, Rocket 0.42%.
- Mismatches (wrong amount, different payer phone digits, expired order) go to `review`, never auto-credited.
- **Fake-SMS defence, three layers.** (1) The phone only forwards SMS whose sender ID is `bkash`, `nagad`,
  `16216` or `upay`, so a look-alike from a personal number never leaves the phone. (2) The server re-checks the
  sender ID and now *requires* it: a payload without one is rejected 403. (3) Balance chain
  (`balance_chain_check`): every provider SMS states the running balance, so genuine messages form a chain a forger
  cannot predict. Verified against the owner's real messages — bKash, Nagad and Rocket all reconcile exactly.
  Call the function BEFORE inserting the row, or it compares the row against itself; stored rows are judged by the
  window-function backfill in migration 004.
- A broken chain only *holds* a payment that could credit an order. An agent's balance also moves through cash-in,
  send money and bill pay, which produce no stored message, so cash-out receipts are marked `chain_status =
  'mismatch'` and left as `tracked_only` rather than flooding review. Confirmed with real data: of the owner's first
  three real Nagad receipts, one broke the chain innocently.
- The remaining hole is alphanumeric sender-ID spoofing, which no amount of text parsing can fix. The balance chain
  is the mitigation; a provider API would be the real fix.
- Rocket agent cash-out (sender `16216`, "B2C: Cash-Out from A/C: ... TxnId: ... Date:28-AUG-26 11:04:50 pm") is a
  confirmed layout. Other Rocket layouts and all of Upay still use the generic parser and are held for `review`
  (`unverified_format`) until real samples exist.
- **Phone health and alerts.** Each approved phone sends `{"action":"heartbeat"}` every ~15 min (WorkManager) with
  battery, monitoring on/off, SMS permission, waiting/failed counts and version. Any authenticated request also
  refreshes `last_seen_at`. The dashboard shows Online / Late (40 min) / Silent (90 min) and a red banner on every
  page. `SILENT_AFTER_MIN` is defined in BOTH `supabase/functions/ingest/index.ts` and
  `dashboard/src/lib/deviceHealth.ts`; `tests/deviceHealth.test.ts` fails if they disagree.
- A `pg_cron` job (`paytrace-watchdog`, every 10 min) calls the unauthenticated `{"action":"watchdog"}`. It is safe
  without a secret: it returns nothing and alerts each phone once (`devices.silent_alerted_at`, claimed before sending
  and released if Telegram fails; cleared when the phone speaks again, which sends "back online"). With Telegram not
  configured it deliberately leaves phones un-alerted so they are reported once it is.
- Telegram text is plain (no `parse_mode`) and built from our own wording; anything from outside (phone names, TrxIDs)
  goes through `clean()`. Sending never throws, never blocks saving a payment (`EdgeRuntime.waitUntil`), and never
  logs the token (a fetch error message can contain it). `{"action":"test_alert"}` lets the signed-in admin send one
  message; it verifies the caller by asking the database `is_admin()` with the caller's own JWT.
- The balance-chain `mismatch` is NOT alerted (cash-outs break it innocently); only payments that go to `review` are.
- A claim is limited to 5 attempts per order to stop TrxID guessing.
- SMS text is untrusted: the dashboard renders it as React children only. Never use `dangerouslySetInnerHTML`.
- Times: SMS times are read as Bangladesh time (+06:00); totals group by Asia/Dhaka.

## Status (2026-10-16)
Done and tested: schema, matching logic, parsers (44 tests incl. the owner's real bKash, Nagad and Rocket receipts),
balance-chain fraud check, device pairing, phone heartbeat + health display, Telegram alert code and watchdog,
two-step login code, CI. `npm test` = 5 files, ~130 checks. The dashboard UI was driven in a real browser against a
simulated Supabase (health states, banner, two-step prompt, wrong code, setup flow, test-message outcomes).

Verified live 2026-10-16: dashboard at paytrace.ashkawser54.workers.dev; phone pairing end to end on a OnePlus
LE2111; three real Nagad cash-out receipts captured, parsed and reconciled; the endpoint answers 401 to unknown
phones, no credentials, a garbage token and the public key alone; the watchdog answers 200 via pg_cron/pg_net;
`is_admin()` two-step rule checked against a throwaway admin (rolled back).

NOT yet verified (be honest about this):
- **Heartbeat from a real phone.** The server side is deployed; the Android side builds in CI but has not run on a
  phone. The installed APK is the OLD one: until the owner installs the new build the dashboard will (correctly)
  show that phone Silent after 90 min.
- **Telegram has never sent a real message**: the owner has not created the bot. `test_alert`'s success path needs the
  owner's real login; only its refusal paths were checked live.
- **Two-step login against real Supabase Auth**: the database rule was verified and the UI was verified against a
  simulated auth server (the library adds the `data:image/svg+xml` prefix to the QR itself; the real server sends raw
  SVG). The first real enrolment is the true test.
- **Signing with the permanent key**: the signing path itself runs on every build (throwaway key), but no permanent
  key exists yet; the owner must run `scripts/create-android-key.sh` and add the 4 GitHub secrets.
- Background survival over many hours and across a reboot; a missed SMS is still lost (no inbox catch-up yet).
- No payment has yet been matched to an order; only cash-out receipts have been seen in the wild.
- bKash/Nagad **received** and **Send Money** layouts were written from general knowledge, not real samples.

## Open items, in rough order
1. Owner: create the Telegram bot and set the two secrets, press "Send a test message" (docs/owner-setup.md step 1).
2. Owner: run `scripts/create-android-key.sh`, add the 4 GitHub secrets, install the signed build (step 2).
3. Owner: turn on two-step login in Settings (step 3). Then confirm `auth.mfa_factors` has one verified row.
4. **Inbox catch-up in the app** (READ_SMS is already granted): scan the SMS inbox on start/boot and every few hours
   for provider messages not yet sent, so a missed broadcast is not lost. The server already ignores duplicates.
   This is the biggest remaining reliability gap.
5. Get real redacted sample SMS for layouts still unseen (bKash/Nagad received + Send Money, Upay).
6. Watch whether `chain_status = 'mismatch'` is rare or constant; revisit the rule if real payments are wrongly held.
7. Order intake: owner has not said how orders are created (website / WhatsApp / store platform), or whether they
   want agent-business tracking only. Plan: an `orders` Edge Function with its own API key (`claim_order` exists).
8. Optional, costs money: Supabase Pro ($25/mo; stops idle pausing and enables leaked-password protection); a second
   phone for redundancy; custom domain. Ask before spending.
9. Run Supabase security advisors after any schema change.
10. Auto-deploy of the Edge Function from GitHub is NOT set up (deploys are manual; repo must equal deployed). It would
    need a Supabase access token as a GitHub secret.

## Known limits to repeat to the owner
Unofficial approach, may breach bKash/Nagad terms (wallet freeze risk); SMS can be spoofed or delayed; phone must stay
on and unrestricted; Play Store will not allow SMS-reading apps (sideload only); official aggregators (e.g. SSLCOMMERZ)
are the safer long-term route.
