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
| Tests | `tests/*.test.ts`, run all with `npm test` (parser, notify wording, phone health, watchdog, dashboard health thresholds, verify-API logic) |
| CI | `.github/workflows/ci.yml` (tests + dashboard build + `deno check` of the function) and `android.yml` (signed APK). Both run on every push |
| Owner guide | `docs/owner-setup.md` (plain language: Telegram, signing key, two-step login) |
| Transaction check API | `supabase/functions/verify-transaction/` (`index.ts`, pure `logic.ts`), SQL `verify_transaction` + `verify_rate` (migration 008), developer guide `docs/verify-api.md` |
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
  The script only uses `gh secret set` if the logged-in account is an ADMIN of the repo (a different logged-in
  account once would have created the key and then failed to save it); otherwise it falls back to the web page.
  `--upload-only` re-loads an existing key; `--copy NAME` puts one value on the clipboard without printing it (needed
  when run from a tool with no terminal). `scripts/test-create-android-key.sh` tests every path (not in CI: needs Java).
  A different Claude working from a stale or separate copy once "re-wrote" this script (`.p12`, clipboard only): the
  real one is on `main`; never accept a push that replaces it.
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
- **Phone health and alerts (fast offline detection).** The always-on foreground `MonitorService` sends
  `{"action":"heartbeat"}` every 30 s (`MonitorService.BEAT_MS`; holds a partial wake lock; started by the app, boot and
  update; the pause switch no longer stops it, it only makes `SmsReceiver`/`InboxScanner` ignore messages and is
  reported as `monitoring:false`). `HeartbeatWorker` (15 min, WorkManager) remains the safety net: inbox catch-up, a
  heartbeat, and a try at restarting the service. A heartbeat carries battery, monitoring, SMS/inbox permission,
  notifications, battery-saver exemption, `setup_complete`, waiting/failed counts and version. Any authenticated
  request also refreshes `last_seen_at`. The dashboard shows Online / Offline (`OFFLINE_AFTER_SEC` = 90, i.e. three
  missed beats) and a red banner on every page. Telegram waits longer (`ALERT_AFTER_MIN` = 3) so a network blip does
  not message the owner; that constant is defined in BOTH `supabase/functions/ingest/index.ts` and
  `dashboard/src/lib/deviceHealth.ts`, and `tests/deviceHealth.test.ts` fails if they disagree. Cost: 2 phones at
  30 s is ~175k Edge Function calls a month plus ~43k for the watchdog, against the free plan's 500k; about 5 phones
  is the free-plan ceiling (ask before suggesting Pro). A phone cannot report that it is dying: "offline" is inferred
  from silence, so a dead battery, no internet and a killed app look the same.
- **Required-permissions gate (Android).** `Setup.kt` (pure `missing()` is unit tested in `SetupTest`) lists what the
  app needs: RECEIVE_SMS, READ_SMS, notifications, battery-optimisation exemption, and (Vivo/OnePlus/Oppo/Xiaomi/
  Samsung and similar, `STRICT_MAKERS`) a hand-confirmed "auto-start" step, because Android cannot report OEM
  auto-start. `SetupScreen.kt` replaces the whole app until nothing is missing and re-checks every 2 s, so it unlocks
  by itself on return from Settings. After one system prompt a runtime permission sends the owner to the app's
  settings (Android will not ask twice). The service's notification text says "Action needed" if one is later taken
  away. Install-time forcing is impossible on Android; the gate is at app open.
- A `pg_cron` job (`paytrace-watchdog`, every minute, migration 007) calls the unauthenticated `{"action":"watchdog"}`. It is safe
  without a secret: it returns nothing and alerts each phone once (`devices.silent_alerted_at`, claimed before sending
  and released if Telegram fails; cleared when the phone speaks again, which sends "back online"). With Telegram not
  configured it deliberately leaves phones un-alerted so they are reported once it is.
- Telegram text is plain (no `parse_mode`) and built from our own wording; anything from outside (phone names, TrxIDs)
  goes through `clean()`. Sending never throws, never blocks saving a payment (`EdgeRuntime.waitUntil`), and never
  logs the token (a fetch error message can contain it). `{"action":"test_alert"}` lets the signed-in admin send one
  message; it verifies the caller by asking the database `is_admin()` with the caller's own JWT.
- **Missed-message recovery (inbox catch-up).** The live SMS listener can miss a message (phone off, app frozen), but
  the SMS stays in the phone's inbox. `InboxScanner` reads `content://sms/inbox` (READ_SMS) on every heartbeat
  (~15 min), at app open and after boot, and stores any provider message not already stored. Rules, all covered by
  `CatchUpTest` (JUnit, runs in CI): only the four provider sender IDs; oldest first (the balance chain checks each
  balance against the one before); first scan looks back 24 h, never more than 7 days; messages already stored are
  matched by provider + exact body, NOT by sender spelling, and do not count against the 200-message batch; the
  resume point is exact after a full batch and 1 h before "now" after a finished scan. (An earlier draft always
  resumed 1 h early, which stalls forever on >200 messages within an hour: the unit test for this must stay.)
  The server dedupes by TrxID, so a message sent twice is harmless. Heartbeat reports `inbox_permission` and
  `recovered`; a missing READ_SMS shows on the Devices page, not in the red banner or Telegram (nothing is being lost
  *yet*). Recovered messages keep their real arrival time as `created_at`/`timestamp`.
- The balance-chain `mismatch` is NOT alerted (cash-outs break it innocently); only payments that go to `review` are.
- **Transaction check API** (`verify-transaction`, `verify_jwt=false`, own auth). For the owner's website admin and
  super-admin servers: `POST {"transaction_id","provider"?}` with `Authorization: Bearer <key>` returns
  `{"found":true|false}`; when found it also returns `provider`, `amount` and `currency` (owner-approved), plus
  `amount_matches` if the caller sent an `amount`; `ambiguous:true` (no amount) if the same ID exists on two providers
  and none was specified. Keys live in the Edge Function secret `VERIFY_API_KEYS` (comma separated,
  each >= 32 chars; the owner types them in the Supabase prompt, Claude never sees them; with none set it answers
  503). `found` = any stored transaction (payment, send money AND cash-out, per the owner) with status `unmatched`,
  `matched` or `tracked_only` (migration 009); `review` (could be a fake SMS) and `ignored` are NOT found, on purpose. 60 lookups/minute per
  key (`verify_rate`, counted in the same SQL call), timing-safe key compare, strings that cannot be a TrxID are
  answered `false` without a query. Non-200 means the caller shows "Pending check" and retries. The response is deliberately limited to
  provider and amount (the owner chose to expose the amount): never add phone numbers, balances or message text. With
  the amount exposed a key can be used to probe IDs, so it stays server-side only and the rate limit matters.
- A claim is limited to 5 attempts per order to stop TrxID guessing.
- SMS text is untrusted: the dashboard renders it as React children only. Never use `dangerouslySetInnerHTML`.
- Times: SMS times are read as Bangladesh time (+06:00); totals group by Asia/Dhaka.

## Status (2026-10-16)
Done and tested: schema, matching logic, parsers (44 tests incl. the owner's real bKash, Nagad and Rocket receipts),
balance-chain fraud check, device pairing, phone heartbeat + health display, Telegram alert code and watchdog,
two-step login code, inbox catch-up logic (19 JUnit tests), CI. `npm test` = 5 files, ~140 checks. The dashboard UI was driven in a real browser against a
simulated Supabase (health states, banner, two-step prompt, wrong code, setup flow, test-message outcomes).

Verified live 2026-10-16: dashboard at paytrace.ashkawser54.workers.dev; phone pairing end to end on a OnePlus
LE2111; three real Nagad cash-out receipts captured, parsed and reconciled; the endpoint answers 401 to unknown
phones, no credentials, a garbage token and the public key alone; the watchdog answers 200 via pg_cron/pg_net;
`is_admin()` two-step rule checked against a throwaway admin (rolled back).

NOT yet verified (be honest about this):
- **Heartbeat from a real phone.** The server side is deployed; the Android side builds in CI but has not run on a
  phone. Phones running an older build do not send the 30 s heartbeat, so the dashboard (correctly) shows them
  Offline until the new build is installed. The setup screen and the 30 s service are also unrun on a real phone.
- **Telegram has never sent a real message**: the owner has not created the bot. `test_alert`'s success path needs the
  owner's real login; only its refusal paths were checked live.
- **Two-step login against real Supabase Auth**: the database rule was verified and the UI was verified against a
  simulated auth server (the library adds the `data:image/svg+xml` prefix to the QR itself; the real server sends raw
  SVG). The first real enrolment is the true test.
- **Signing with the permanent key**: the signing path itself runs on every build (throwaway key), but no permanent
  key exists yet; the owner must run `scripts/create-android-key.sh` and add the 4 GitHub secrets.
- **Inbox catch-up on a real phone.** The selection logic is unit-tested and the app builds, but it has never read a
  real inbox. First real check: after installing, the phone screen should say "Inbox last checked ... Nothing was
  missed" or "Recovered N", and the Devices page should show the same. Also unverified: that the live listener and
  the scan agree on sender spelling on a real phone (the body-based "already stored" check is there for this).
- Background survival over many hours and across a reboot.
- No payment has yet been matched to an order; only cash-out receipts have been seen in the wild.
- bKash/Nagad **received** and **Send Money** layouts were written from general knowledge, not real samples.

## Open items, in rough order
1. Owner: create the Telegram bot and set the two secrets, press "Send a test message" (docs/owner-setup.md step 1).
2. Owner: run `scripts/create-android-key.sh`, add the 4 GitHub secrets, install the signed build (step 2).
3. Owner: turn on two-step login in Settings (step 3). Then confirm `auth.mfa_factors` has one verified row.
4. Confirm inbox catch-up on the owner's phone (see above). A recovered message that is an older receipt can leave
   the NEXT stored message's `chain_status` as `mismatch` (it was judged before the missing one existed); harmless for
   cash-outs, which are never held for it.
5. Get real redacted sample SMS for layouts still unseen (bKash/Nagad received + Send Money, Upay).
6. Watch whether `chain_status = 'mismatch'` is rare or constant; revisit the rule if real payments are wrongly held.
7. Order intake: owner has not said how orders are created (website / WhatsApp / store platform), or whether they
   want agent-business tracking only. Plan: an `orders` Edge Function with its own API key (`claim_order` exists).
8. Optional, costs money: Supabase Pro ($25/mo; stops idle pausing and enables leaked-password protection); a second
   phone for redundancy; custom domain. Ask before spending.
9. Run Supabase security advisors after any schema change.
10. `npm audit` reports `@supabase/auth-js <=2.69.1` (low, GHSA-8r88-6cj9-9fh5: path routing in the ADMIN methods such
    as `getUserById` when fed unvalidated input) and dev-only `esbuild`/`vite` advisories (affect only a local dev
    server). Not exploitable here: the dashboard holds only the publishable key and never calls admin methods; the
    function pins the same version but does not call them either. **Do not bump `@supabase/supabase-js` blindly**:
    `mfa.enroll()` prefixes the QR code with `data:image/svg+xml;utf-8,` itself, so a version that changes that breaks
    two-step setup. Upgrade only together with a real enrolment test against Supabase Auth.
11. Owner: set `VERIFY_API_KEYS` (docs/owner-setup.md step 5) and give each website server its key; then do one real
    call with a known TrxID. Not yet verified end to end: only the SQL (rolled-back test rows) and the 401/503 paths.
12. Auto-deploy of the Edge Function from GitHub is NOT set up (deploys are manual; repo must equal deployed). It would
    need a Supabase access token as a GitHub secret.

## Known limits to repeat to the owner
Unofficial approach, may breach bKash/Nagad terms (wallet freeze risk); SMS can be spoofed or delayed; phone must stay
on and unrestricted; Play Store will not allow SMS-reading apps (sideload only); official aggregators (e.g. SSLCOMMERZ)
are the safer long-term route.
