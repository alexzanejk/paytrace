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
| Transaction check API | `supabase/functions/verify-transaction/` (`index.ts`, pure `logic.ts`), SQL `verify_transaction` + `verify_rate` + `api_keys` (migrations 008-011), dashboard page `dashboard/src/pages/ApiAccess.tsx` (+ `lib/apiDocs.ts` developer text), developer guide `docs/verify-api.md` |
| Deposit gateway | Edge Function `supabase/functions/gateway/` (`index.ts`, pure `logic.ts`; `verify_jwt=false`, own key auth), customer pay page `dashboard/pay/index.html` + `dashboard/src/pay/` (served at `/pay/`; the folder form is deliberate: `/pay` and `/docs` as bare .html files fell through to the dashboard login page on Cloudflare), SQL migration 014, dashboard: Phones → Deposit numbers (`WalletsCard`), API access → deposits + result address (`WebhookCard`), Orders → Source column. Guide `docs/gateway-api.md` |
| Partner commission | `commission_rates`, `commission_payouts`, views `device_commission_daily`/`device_commission_balance` (migration 019), dashboard Phones → Partner commission (`CommissionCard`) and the **Commission** page, `ingest` action `earnings`, phone app `Earnings.kt`/`HomeCards.kt` |
| Agent jobs | `job_settings`, `job_completions`, view `device_open_jobs` (migration 020), dashboard **Jobs** page, `ingest` actions `jobs`/`job_done`, phone app `Jobs.kt`/`HomeCards.kt` |
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
- **UX polish pass (owner request 2026-10-23, looks and ease of use only; no function changed).** Dashboard: `StatCard` + `STAT_GRID` (two cards per row on a phone, values never wrap), `Screen` shows a placeholder layout while loading, `Disclosure` folds the Deposit numbers and Partner commission sections of a phone card (summary shows owed amount / number count), Review and Orders are cards with a `PageHeader` (Orders and Transactions use cards below 1280/1024 px, the table above), table cells fold secondary figures into a small line under the row on phones, filters sit two to a row, visible keyboard focus, brand mark, page fade-in (off for reduced motion). Re-checked in a real browser at 1280 and 390 px against simulated data, and the commission flow script still sends the same RPC bodies. Android: brand header, round status badge on Home, larger monospaced pairing code, Settings sections in cards (wording and behaviour unchanged; compiled only by CI, never seen on a phone). Not done: a light/dark switch (the dashboard follows the browser), translating the dashboard, bottom tab bar on phones.
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
- **Surviving the phone brand's power manager.** Observed 2026-10-17: Vivo killed the service outright (no notification,
  Offline) and OnePlus froze it while the screen was off (back online when the screen woke). The standard battery
  exemption does not stop that on Vivo/OnePlus/Oppo/Xiaomi/Samsung. Mitigations in the app: `Setup.brandSteps` (per-brand
  checklist on the gate, re-asked once via `autostart_confirmed_v2`, and repeated on the app's first screen);
  `Keepalive` alarm (`setAndAllowWhileIdle`, pushed 45 s ahead on every beat, restarts the service if it dies silently;
  5 s ahead from `onDestroy`/`onTaskRemoved`, where the app is told it is stopping; some brands cancel alarms when they
  stop an app; a hard kill gives no callback, so ~45 s is the floor there); a Wi-Fi lock beside the CPU wake lock;
  `startForeground` failures are caught instead of crashing; `BeatGap` counts a 5+ min gap with the phone still up
  (uptime clock, so a reboot is not counted) as "stopped by the phone", reported as `stopped_count`/`last_gap_min` and
  shown on the Devices page. It cannot be made 100% in software; Firebase push would be the next step if settings are not enough.
- **Learned from analysing the owner's ZiniPay APK (static only, never run; its code was not copied):** it is a normal
  SMS-forwarder to its own cloud (`api.zinipay.com`, API key + deviceId, raw SMS, weak regex parsing, no heartbeat,
  plain SharedPreferences). Its survival tricks that PayTrace now also has: (1) optional **SMS app mode** (default SMS
  app: `SmsDeliverReceiver` + `MmsDeliverReceiver` + `RespondViaMessageService` + SENDTO filter on `MainActivity` make the
  app eligible; `DefaultSms` asks via RoleManager (API 29+) or ACTION_CHANGE_DEFAULT; while default, Android no longer
  writes SMS itself so `SmsIntake.saveToInbox` writes EVERY message to the inbox FIRST, non-payment messages get a
  notification via `notifyOther`, payments go through `SmsIntake.handlePayment`, which dedupes by sender+body so a second
  copy via `SmsReceiver` is harmless; PayTrace cannot send SMS/MMS; reported as `default_sms` in the heartbeat and shown
  as "SMS app mode" on the Devices page); (2) **one-tap vendor screens** (`OemSettings.candidates/open`, component names
  for Vivo/iQOO, OnePlus, Oppo/Realme, Xiaomi, Huawei, Samsung, Transsion (Tecno/Infinix/itel), Asus; each is tried in
  turn with try/catch, then falls back to app details; `brandSteps` has a HiOS list); (3) **send on reconnect**
  (`MonitorService` registers a default `NetworkCallback`; `ReconnectGate` fires only when the network becomes
  VALIDATED, at most every 5 s, so a flapping link cannot burn message retries; `Reconnect.onInternetBack` resets
  recent FAILED messages that failed for network reasons (not `HTTP 4xx`), re-queues PENDING ones and sends a
  heartbeat). `SendWorker.enqueue` now uses unique work per message (`send-<id>`, REPLACE) so a re-queue replaces the
  delayed retry instead of piling up copies. None of this has run on a real phone yet.
- **Stronger keep-alive + full SMS app (2026-10-18, after the Vivo still died with SMS app mode on):** `Keepalive` now also
  sets a 5-minute `setAlarmClock` backup (`strongAlarm` setting, default on; AlarmClock alarms are the ones OEMs almost
  never cancel; side effect: alarm icon / "next alarm" on the lock screen); the quick 45 s alarm's receiver also sends a
  heartbeat itself (`goAsync` thread) so the dashboard is right even if the service is slow to start; the service notice
  uses channel `monitor_v2` (IMPORTANCE_DEFAULT, silent, CATEGORY_SERVICE, FOREGROUND_SERVICE_IMMEDIATE) because the old
  low-importance channel is hidden/deprioritised on some brands, and a `deleteIntent` re-posts it if swiped away
  (Android 14 allows dismissing); `stopWithTask="false"`. In SMS app mode the app is a basic SMS client: `Messages` tab
  (`MessagesScreen`: conversations via `ThreadGrouping`, thread view, new message, send), `SmsStore` (query/mark read/
  send through `SmsManager` with sent/delivered `PendingIntent`s written back to the provider; only works as default
  SMS app; needs runtime SEND_SMS, asked lazily), notification "Mark as read" + tap opens the thread
  (`LaunchRequest`), `RespondViaMessageService` sends quick replies. NOT supported: MMS (incoming MMS is dropped:
  `MmsDeliverReceiver` is a stub), contacts names, dual-SIM choice, drafts, deleting. Nothing here has run on a phone.
- **1:1 check against the ZiniPay list (owner asked, 2026-10-18):** always-on service + notification + wake lock (have);
  restart within seconds when stopped/swiped (have: `onDestroy`/`onTaskRemoved` -> 5 s alarm); background watchdog
  (have: `HeartbeatWorker` 15 min restarts the service, plus the alarms); restart after reboot (have, now also the
  QUICKBOOT_POWERON fast-boot actions); battery-limit exemption (have, on the gate); default SMS app + one-tap
  autostart pages (have; added a one-time "make PayTrace the SMS app?" dialog after setup and a banner on the first
  screen while it is not the SMS app, like ZiniPay's `default_sms_prompted`/banner); send waiting messages when the
  internet returns + re-read the inbox (have; the inbox is now also re-read on reconnect, when the service starts and
  every 5 minutes via `INBOX_EVERY_BEATS`). Also copied from ZiniPay: SMS receivers hold a short wake lock and start the
  service (`SmsIntake.runAwake`, `goAsync`). Deliberately NOT copied: ZiniPay's `dataSync` foreground type (Android 15 stops
  dataSync services after ~6 h; PayTrace keeps `specialUse`). PayTrace-only extras were left untouched.
- **Phone app is deliberately minimal (owner's request, 2026-10-18, modelled on ZiniPay's simple look):** three tabs, Home (one status card: Running / Not connected / Needs attention, the pairing card, permission warnings, SMS-app banner), Messages, Settings (SMS app mode, extra-strong keep-alive, battery help + one-tap pages, Advanced URL/secret). Removed from the phone on purpose: today's totals, cash-out figures, sent/failed/waiting counts, the log list, the per-provider switches, the pause switch, field checkboxes and retry settings. Those are dashboard-managed; the app resets monitoring and all providers to ON at start so nothing can stay switched off unseen. Not yet built on a phone; CI compiles it.
- **Dashboard organised around phones (owner's request, 2026-10-18).** `payments.device_id` (migration 012, filled by `ingest` for every new payment; older rows backfilled from the `created` event, a few may be null = "Unknown phone"). Views `device_day_totals` (Bangladesh day x phone x provider x type x status), `device_balances` (newest printed balance per phone and provider) and `provider_balances`; RPC `rename_device` (admin-only, 1-40 chars). Totals count only `unmatched`/`matched`/`tracked_only` (`COUNTED_STATUSES` in `lib/period.ts`): payments held for review or ignored are never in the money totals. A "day" is 12:00 AM to 11:59 PM Asia/Dhaka (`lib/period.ts`, tested in `tests/period.test.ts`). Pages: Overview (period + phone filter, last known balance per provider, by-phone table), Transactions (was Payments: filters for period, phone, provider, type, status, TrxID/number search, totals strip, expandable rows with the raw SMS as plain text, CSV download with formula-safe cells, 100 at a time), Phones (was Devices: one card per phone with rename, day totals, per-provider received/cash-out/last balance, health, "View transactions" which opens Transactions pre-filtered via `lib/filters.ts`), Review shows the phone too. Navigation is a left menu on wide screens (Review count badge, "N of M phones online"), a top menu on phones. Phone colours come from `lib/deviceColors.ts` (initial in a coloured circle, never a plain dot: a dot looks like the Online/Offline light). Driven in a real browser against a simulated Supabase (desktop and phone width); not yet seen with the owner's real data.
- **Firebase wake-up pushes (2026-10-22, owner approved; none of it has run yet).** `WakeService` (FirebaseMessagingService) starts `MonitorService`, sends a heartbeat and runs the inbox scan when a high-priority data message arrives (allowed to start a foreground service from the background). `Push.refresh` asks Firebase for the phone's token at app open and service start; the heartbeat carries `push_token` when new and then every 30 min (`PushPolicy`, unit tested) plus `push_ready`. Server: table `device_push` (migration 013; RLS on, no policies, so only the Edge Function reads tokens), `supabase/functions/ingest/{wake.ts,fcm.ts}`: the every-minute watchdog calls `runWake`, which sends an FCM HTTP v1 message (`priority HIGH`, `ttl 60s`, data `type=wake`) to approved phones quiet for 100 s, at most once per 10 min per phone (`claim` is atomic), and forgets tokens FCM calls invalid. Auth is a service-account JWT signed in the function (`crypto.subtle`, RS256) from the Edge secret `FIREBASE_SERVICE_ACCOUNT` (owner sets it via the private secret prompt; never in chat or repo). The Android build adds the Firebase config from the GitHub secret `GOOGLE_SERVICES_JSON` only if present (the `google-services` plugin is applied only when `android/app/google-services.json` exists, so builds stay green without it, and `Push.refresh` swallows the missing-config error). No secret = push does nothing, everything else unchanged. Not guaranteed: if the OEM force-stops the app, FCM is blocked too. Owner steps: docs/owner-setup.md step 6.
- **Browser access to the ingest function (CORS, 2026-10-22).** The dashboard's admin buttons (`test_alert`, `test_wake`) call `ingest` from the browser with the admin's token in a header, so the function answers the browser's OPTIONS check and adds CORS headers only for the dashboard's own origin (`supabase/functions/ingest/cors.ts`, from `DASHBOARD_URL`; never `*`). Before this, both buttons failed with "Could not reach the server" because the function had no CORS handling (the Telegram test button had never worked from the real dashboard). Phones are not browsers and are unaffected.
- **Phone-settings guide (2026-10-22, owner's request after the Vivo's "Allow high background power consumption" was found on "Optimized").** `Setup.guide(manufacturer)` returns structured `GuideStep`s per brand (id, title, `path` = where to find it, `choose` = the exact option, `avoid` = the option that looks right but is wrong, `why`, `Open` = which page the button opens), unit tested in `SetupTest`. `PhoneSettingsGuide` (GuideScreen.kt) shows them as cards with an Open button and an "I have done this" tick each; ticks are `AppSettings.guideDone` (key `guide_done_v3`, so every phone is asked again once). The setup gate's AUTOSTART requirement is now "every guide step ticked" (`Setup.guideComplete`), replacing the single "I have done all of these" button; the same guide is on the Settings tab under "Keep this phone running". Android cannot read OEM settings, so ticks are the owner's word. `brandSteps` text list is kept (old tests) but no longer shown. Not reported to the server/dashboard yet (would need a heartbeat field and an ingest redeploy). Not yet run on a phone.
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
  and none was specified. Keys are made and revoked by the owner on the dashboard's **API access** page (`create_api_key` /
  `revoke_api_key`, admin-only, two-step rule applies): `ptk_` + 64 hex, shown once, only the SHA-256 hash is stored in
  `api_keys` (admins can read name/prefix/dates, never the hash), 20 active at most, `last_used_at` is updated at most
  once a minute. The function format-checks the bearer, hashes it and `verify_transaction` checks it is live (revoked
  or unknown = 401, even for junk IDs). There is no environment secret any more. `found` = any stored transaction (payment, send money AND cash-out, per the owner) with status `unmatched`,
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
11. Owner: make one key per website server on the dashboard's API access page (docs/owner-setup.md step 5) and give each
    its key; then one real call with a known TrxID. Verified live with a throwaway key (found/amount/mismatch/not found/
    bad key/bad amount); the dashboard page was driven in a browser against a simulated Supabase; creating a key with the
    owner's real login has not been done. NOTE: the Supabase MCP `execute_sql` hangs (60 s timeout) on DELETE/DROP,
    probably a confirmation prompt the owner never sees; use UPDATE or ask the owner. A leftover test payment
    `ZZLIVE9001` (status `ignored`) may still be in `payments` until the owner allows a delete.
12. Auto-deploy of the Edge Function from GitHub is NOT set up (deploys are manual; repo must equal deployed). It would
    need a Supabase access token as a GitHub secret.

## Deposit gateway (2026-10-22, owner request; deposits done, withdrawals NOT built yet)
- Owner's answers: only the owner's own sites (one API key per site, no multi-merchant accounts); create-order API + redirect + signed
  webhook; wallet number rotates across approved phones that have a number for the chosen provider (online first, least recently
  handed out); withdrawals = a request queue the owner pays by hand (not built yet; plan: `withdrawals` table, dashboard queue,
  owner enters the TrxID, webhook `withdrawal.paid`; it cannot be automatic, the providers give no way to send money from an app).
- The deposit-method chooser ("Bkash Send Money", "Nagad VIP Cash Out", ...) is the WEBSITE's own page, not PayTrace's (owner corrected this 2026-10-22). `create-deposit` therefore requires `provider` (optional `method` `send_money`|`cash_out`) and assigns the wallet at creation (`gw_find_wallet`, migration 015); PayTrace's page starts at the TrxID step. Logos in `dashboard/src/pay/logos/` were supplied by the owner (bKash, Nagad, Rocket; Upay has none, a monogram is used).
- Pay page matches the owner's screen recordings 1:1 (2026-10-22): two layouts, `cash` (green header, red-bordered TrxID box, Wallet No) and `send` (header and banner in the provider colour, `ওয়ালেট প্রদানকারী`, grey TrxID box), exact Bangla wording in `dashboard/src/pay/i18n.ts`; floating-label input, the blue "how to get the TrxID" link that appears after the box is used, the "How to complete a cash transaction?" popup (own SVG illustration, `HowToImage.tsx`), the English confirm dialog with a dimmed page, green "Copy Success" and red error toasts, the red warning line pulsing 0.9 to 1.2 every 1.7 s (`pay.css`, stopped by reduced-motion). Three layouts: `cash`, `send` (Nagad-style) and `bsend` (personal bKash Send Money: green header, "বিকাশ Deposit", full-width button, the bKash menu tiles and a mm:ss "বাকি সময়" countdown under the form). The "how to find the TrxID" popup differs per provider/way of paying (`HowTo.tsx`): the Nagad cash-out receipt, Rocket SMS screen and bKash Send Money menu are the owner's REAL images (`dashboard/src/pay/help/`); the bKash cash-out receipt and the bKash send-money steps are still drawn by us (no real image supplied). NOT built: the floating "বাতিল করুন" (cancel order) pill seen in the recordings of Rocket and bKash send money. Dialogs/toasts from the reference stay English in both languages; "PAY SERVICE" in the header is placeholder branding. A payment timer is shown in both layouts (the cash-out recording had none, but our orders expire).
- **Result page looks (owner request 2026-10-22):** the submission page is identical for every site, but what the customer sees AFTER pressing Confirm (waiting, paid, held, expired) comes in six looks (`dashboard/src/pay/ResultScreens.tsx`: Aurora, Steps, Receipt, Checklist, Ring, Playful), so sites do not look the same. `api_keys.result_style` (0-5, null = automatic = `hashtext(key id) mod 6`, stable per site; migration 016), set by the owner on API access → "How the result page looks" (`set_key_result_style`); `gw_order_view` returns `result_style`. Preview: demo bar "After Confirm, look" buttons; TrxID REVIEW001 / EXPIRED01 in demo end in held / expired. The submission page must NOT be changed for this.
- **Partner integration guide + Websites page (2026-10-23):** public guide at `/docs/` (`dashboard/docs/index.html`, `src/docs/{DocsPage,samples}.tsx`; steps, field tables, curl/Node/PHP/Python samples, webhook signature check, errors, go-live checklist; no secrets). The dashboard page formerly called "API access" is now **Websites** (`pages/ApiAccess.tsx` + `components/SiteCard.tsx`): one card per website key with its result address (webhook + one-time secret), result look, developer brief and revoke; plus the guide link, a 3-step strip, revoked keys and the optional transaction-check API folded away. Docs and samples must be kept in step with `lib/apiDocs.ts` and the gateway function.
- **White-label embedding (owner request 2026-10-23: customers must never see "PayTrace" or the dashboard address).** The pay page has no brand text (title "Payment", header "PAY SERVICE" placeholder) and can be framed: `dashboard/public/_headers` keeps `X-Frame-Options: DENY` + `frame-ancestors 'none'` for everything (dashboard) but detaches them for `/pay` and `/pay/*` and sets `frame-ancestors https:` (any https site; the tracking number is the secret; per-site restriction is not possible with static headers). NOT yet verified on the live Cloudflare site. `dashboard/src/pay/embed.ts`: framed pages `postMessage` `{source:"deposit-page", type:"height"|"state"|"redirect"}` to the parent (no secrets), try `window.top.location`, and drop `min-h-screen` (`html[data-framed]`, else the frame could never shrink); the website listens (guide section "Keep customers on your site", `EMBED` in `docs/samples.ts`). Per-site landing pages: `api_keys.redirect_success_url` / `redirect_failed_url` (migration 018, `set_key_redirects`, Websites card section 3); `gw_order_view` returns `return_url` (order's own wins) when paid and `failed_url` when expired/cancelled; the page leaves 4 s / 8 s after. Live DB also has two EMPTY unused columns `api_keys.success_url`/`failed_url` (first attempt had an invalid regex; DROP hangs on the MCP). Developer-facing names are neutral: webhook headers `X-Webhook-Signature`/`X-Webhook-Event`, user-agent `Deposit-Webhook/1`, docs/samples say "the gateway". Still visible to someone using browser dev tools: the frame's address (`workers.dev`) and the Supabase function address; hiding them needs a custom domain (costs money: ask) and a proxy. The guide also gives a full-screen recipe (`FULLSCREEN` in `docs/samples.ts`): one site page that is only the frame, no site header/menu (owner's reference: a site page `.../depositIframe`). In that reference the "বাতিল করুন" pill and the X look like the HOST site's overlay on top of the frame; a customer-side cancel button inside our page is still not built (ask the owner). Owner's recordings (777bajii vs 899ok5, 2026-10-23): after the site's own "Next" button 777bajii showed nothing for ~3-4 s before our page, 899ok5 shows a spinner + "submitting" text at once. Our part: `dashboard/pay/index.html` now holds an instant green-header spinner (replaced by React) so the page is never blank; the site's part is documented in the guide (`PROGRESS` sample, "Show progress the moment the customer presses Next"). Six copy-paste loading animations for the SITE's Next button (owner's references: 899ok5 dark box, pkok white card) are data in `dashboard/src/docs/loaders.ts` (css + markup + script; every one defines `showLoading(text)`/`hideLoading()`), shown with live previews by `LoaderPicker.tsx` in the guide section "Show progress on Next"; `tests/loaders.test.ts` checks the data and each was pasted into a plain page and clicked in a browser. Pay page sizes follow the reference's own code (owner supplied `gateway-frontend-analysis.zip`, Quasar/Vue `BDPayPage`; exact values read from its JS+CSS): header 74 px high, 28 px content padding, 8 px gaps between blocks (its xs gutter), 16 px inside the TrxID group, 76 px banner (60 px logo + 8 px padding), 56 px inputs, ~47 px button, 12.8 px caution text; it shows the TrxID help link only after the box is focused (owner chose this 2026-10-23, so ours does the same: `touched` state in `PayPage.tsx`, the link stays once shown) and has no timer. Ours adds a timer (put on the Wallet No line, zero height). Two tiers in `PayPage.tsx`: 360 px and wider = the reference's own sizes and spacing (24 px line height, 16 px text, 74 px header, 28 px padding, 76 px banner, 56 px boxes; ~605-635 px tall, reference ~585; the owner found the earlier tighter set "too stressed on top of each other" on a 409 px phone, so the cramped set was cut back to under 360 px only); under 360 px = a tighter set; the personal bKash Send Money layout (menu picture) is scaled with CSS `zoom` on phones (`pay.css`, ~590-690 px). Breakpoints use `min-[360px]:`/`max-[359px]:`; `sm:` (640) only drives the desktop card. Fonts: the reference ships Roboto (400/500/700) and our page used to rely on whatever the phone had, which drew Latin text thin and mis-spaced ("BDT 1, 000", unbold "Wallet No") on an owner's phone (777bajii, 2026-10-23); the pay page now bundles `@fontsource/roboto` latin 400/500/700 (`pay/main.tsx`) and `FONT` starts with Roboto, Bengali falls through to the phone's Bengali font. The timer line only shows in the last 3 minutes (the reference has none). In a frame the form page is one continuous white page (owner's 777bajii screenshot showed a shadowed card ending above a second white area): `markFramed()` in `pay/main.tsx` sets `html[data-framed]` before first paint and `pay.css` then removes the grey surround, shadow, radius and padding on the form (`data-page="form"`) and paints the canvas white; result screens keep their own card. Re-measure after layout edits (a Playwright script that reads the height from the green header down). The six loading animations were redone to be minimal (thin rings, fade-in, `--ld-accent` colour variable, widths that fit 320 px). Demo preview: `/pay/?demo=1&return=https://...&failed=https://...` pretends the site's pages.
- **Partner commission (owner request 2026-10-23; NOT a Finunity-style public partner programme, the owner dropped that).** People who provide bKash/Nagad/Rocket/Upay agent (Cash Out) or personal (Send Money) accounts earn a % of the DAILY TOTAL through their phone; the owner sets the rate per phone x provider x kind (`cash_out` = `txn_type cash_out`, `send_money` = `send_money_received`; `payment_received` and `unknown` earn nothing) and the partner sees earnings in the PayTrace phone app. Bookkeeping only: PayTrace never moves money, the owner pays partners outside and records payouts. Migration 019: `devices.show_earnings` (default false), `commission_rates` (effective-dated: the newest rate starting on or before the day applies, earlier days keep theirs), `commission_payouts` (voided, never removed), views `device_commission_daily` (reads `device_day_totals`, counted statuses unmatched/matched/tracked_only like the dashboard totals, held `review` earns nothing until approved) and `device_commission_balance`, admin-only RPCs `set_commission_rates`, `set_device_earnings_visible`, `add_commission_payout`, `void_commission_payout`, and service-role-only `device_earnings(device)` which the `ingest` function returns for `{"action":"earnings"}` (phone key auth; empty `{enabled:false}` unless switched on). Dashboard: Phones card `CommissionCard.tsx` (rate grid, show-in-app switch, earned/paid/owed), page `pages/Commission.tsx` (menu "Commission": per partner balances, day by day, payouts, CSV), pure helpers `lib/commission.ts` (`tests/commission.test.ts`, 24 checks). Android: `Earnings.kt` (parser, formatter, request), `EarningsCard.kt` (Home card only when enabled; refreshes every 60 s while Home is open and keeps the last numbers offline), `EarningsTest.kt`; the app stays minimal on every phone where the switch is off. Tested live with a throwaway phone inside a rolled-back transaction (rates 4% then 5% from today, held and other message types excluded, voided payout not counted, non-admin and bad input refused). NOT verified: the Android card and its tests were only compiled by CI (no Android SDK in the cloud sandbox) and have never run on a phone; a phone needs the new app build before the card appears. The owner's earlier answers: rates per provider as well as per kind, payout record yes, app only (no separate partner web login). Not built on purpose: partner logins, public recruiting page, income claims, security deposits, USDT/conversion flows (owner agreed to skip them).
- **Agent jobs + modern phone app (owner request 2026-10-23).** An AGENT is one wallet (provider) on one phone, not the whole phone (owner correction 2026-10-23: the first version gave one job per phone). The owner writes a default job on the dashboard's **Jobs** page (`pages/Jobs.tsx`, `lib/jobs.ts`, `tests/jobs.test.ts`): on/off, an amount (default 10,000 Tk), the instruction (placeholders `{agent}`, `{provider}` and `{balance}` are filled per agent), an urgency (`normal`|`urgent`|`critical`) and a default wallet address per provider; each agent card can override name, instruction, urgency and wallet, or be switched off (`agent_jobs`, migration 021, admin-only `set_agent_job`; the five-argument `set_job_settings` adds the urgency; empty override = use the default). The job's wallet is the owner's own crypto wallet (Trust Wallet, network BNB Smart Chain (BEP20)): one pasted address fills every wallet type (agents may override it), a `network` text rides with it (`job_settings.network`, `agent_jobs.network`, migration 022, six-argument `set_job_settings` and eight-argument `set_agent_job`), an address starting `0x` must be exactly 0x + 40 hex characters (checked in the dashboard and in the database), the default urgency is Urgent, and the phone card shows the network with a send-only-on-this-network warning. Two agents of the same provider on one phone cannot be told apart because the SMS does not name the account, so they share one balance. Migration 020: `job_settings` (one row), `job_completions`, view `device_open_jobs` (an agent's newest printed balance, from `device_balances`, at or above the amount, wallet set, not marked done since that balance was printed), admin-only `set_job_settings`, service-role `device_jobs(device)` and `device_job_done(device, provider)`. `ingest` actions `jobs` and `job_done` (phone key auth). WHY Done exists: sending money out makes no message PayTrace stores, so the balance cannot show the work was done; after Done the job returns only when a NEWER balance message is still at or above the amount (tested live in a rolled-back run). Not built: a notification or sound when a job appears while the app is closed (the app checks every 30 s while open; the Home icon shows a badge), and a per-agent amount. Phone app: bottom `NavigationBar` (Home, Messages, Settings) replaces the top tabs; Home is a header with a status pill, one `JobCard` per agent, most urgent first (`HomeCards.kt`: "কাজ করুন এখনই", the agent's name and balance, an urgency label and card colour, the instruction in a box, the wallet address with Copy, Done with a confirm), then, only when the owner switched earnings on, `EarningsSection` (big earning balance = earned minus paid, today, this month, by account, last 7 days). `App()` in MainActivity.kt polls jobs every 30 s and earnings every minute and keeps the last numbers offline. `Jobs.kt` (+ `JobsTest`) holds the parser and requests; `EarningsCard.kt` was removed (replaced by `EarningsSection`). Dashboard Jobs page and the DB rules were tested (browser against simulated Supabase; live rolled-back SQL); the Android code is only compiled by CI and has never run on a phone.
- Deposit amount limits (owner, 2026-10-23): minimum 500, maximum 50000 taka, enforced in `gw_create_deposit` (migration 017) and stated in the guide.
- Flow and fields are in `docs/gateway-api.md` and `dashboard/src/lib/apiDocs.ts` (`depositInstructions`). Pay page is written from
  scratch (modelled on the owner's screenshots of a third-party page; none of its code or images was copied). Bangla default, EN toggle.
- Tables: `device_wallets` (phone x provider -> number, method `send_money`|`cash_out`, enabled), `webhook_outbox` (retried 8 times),
  `orders` gained `kind` (`manual`|`deposit`), `tracking_number` (the unguessable pay-link secret), `api_key_id`, `merchant_order_id`
  (unique per key = idempotent create), `provider`, `device_id`, `wallet_number`, `wallet_method`, `return_url`; `api_keys` gained
  `webhook_url` (readable by admins) and `webhook_secret` (never readable; shown once by `set_key_webhook`). SQL `gw_*` functions are
  service-role only; the function calls them.
- Crediting still goes ONLY through `claim_order`/`reconcile_payment`/`manual_match`. Changes there: a stored `tracked_only` Cash Out
  receipt can pay an order whose wallet method is `cash_out` (held for review if its `chain_status` is `mismatch`); a payment from a
  different phone than the number shown is held (`wrong_phone`); a claimed order gets 10 min grace past `expires_at` for a late SMS.
  A Cash Out receipt can never pay a Send Money order. Ingest now also reconciles `tracked_only` receipts (a claim can come first).
- A pg_cron job `paytrace-gateway-deliver` calls `gateway/deliver` every minute (sends waiting webhooks, expires unpaid orders); ingest
  and the pay-submit route also trigger it right after a match.
- Public pay routes are callable from the browser only from the dashboard's own origin (`DASHBOARD_URL`). The pay page lives on the
  dashboard's address for now; a custom domain would be better for customers (ask before buying one).
- **The Supabase MCP `apply_migration`/`execute_sql` hangs (60 s) on any statement containing DROP or DELETE** (even `drop policy if
  exists`, or `delete` inside a function body), and nothing is applied. Write migrations without them. A plpgsql `if ... then` cannot
  contain a `case ... then` in its condition (the parser stops at the first THEN): compute it into a variable first.
- Tested live with a throwaway admin/phones/key inside a rolled-back transaction (create, idempotent retry, different amount refused,
  bad key, rotation, send-money match, claim-first, wrong phone, cash-out ok/mismatch, cash-out on a send-money order, webhook queueing),
  the function answered 404/401/200 via pg_net, and the pay page and dashboard pages were driven in a browser against a simulated gateway.
  NOT yet done: a real order end to end with real money, a real webhook to a real site, withdrawals.

## Known limits to repeat to the owner
Unofficial approach, may breach bKash/Nagad terms (wallet freeze risk); SMS can be spoofed or delayed; phone must stay
on and unrestricted; Play Store will not allow SMS-reading apps (sideload only); official aggregators (e.g. SSLCOMMERZ)
are the safer long-term route.
