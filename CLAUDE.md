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
| Android app | `android/` (Kotlin, Compose, SQLite, WorkManager). GitHub Actions builds `app-debug.apk` (artifact `paytrace-apk`) |
| Parser tests | `tests/parser.test.ts`, run `node --experimental-strip-types tests/parser.test.ts` |
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
- The publishable key inside `dashboard/index.html` is public by design; RLS protects the data.
- Admin login: one Supabase Auth user, listed in `public.admins`. Public sign-ups should be OFF in Supabase Auth.

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
- Amount, fee and commission are separate columns. Nagad states commission (`Comm:`); bKash SMS does not, so bKash
  commission is 0 until a configurable rate is added.
- Mismatches (wrong amount, different payer phone digits, expired order) go to `review`, never auto-credited.
- Rocket and Upay use a generic parser and are always held for `review` (`unverified_format`) until real samples exist.
- A claim is limited to 5 attempts per order to stop TrxID guessing.
- SMS text is untrusted: the dashboard renders it as React children only. Never use `dangerouslySetInnerHTML`.
- Times: SMS times are read as Bangladesh time (+06:00); totals group by Asia/Dhaka.

## Status (2026-10-16)
Done and tested: schema, matching logic (10 abuse scenarios, rolled back), parsers (32 tests, including the owner's real
bKash and Nagad Cash Out messages), endpoint deployed and confirmed to reject unauthenticated calls, Android app
compiles in CI.

Verified 2026-10-16: dashboard live at paytrace.ashkawser54.workers.dev (owner signed in); phone pairing worked end
to end on a OnePlus LE2111 (pair request, approval in Devices tab, authenticated connection test).

NOT yet verified (be honest about this):
- Real SMS capture on the phone, background survival and reboot are untested; no real payment has gone through yet.
- bKash/Nagad **received** and **Send Money** layouts were written from general knowledge, not real samples.
- Endpoint was never called with the real secret (the sandbox could not reach Supabase).

## Open items, in rough order
1. Make a small real bKash/Nagad payment to the paired phone and confirm it appears in the dashboard.
2. Check the phone keeps forwarding after hours in the background and after a reboot.
3. Get real redacted sample SMS (bKash/Nagad received, Send Money; Rocket/Upay) and fix parsers + tests.
4. Order intake: owner has not said how orders are created (website / WhatsApp / store platform). Plan: an `orders`
   Edge Function with its own API key for create-order and claim-payment calls (`claim_order` already exists).
5. Permanent Android signing key so updates install over older builds (store as GitHub secrets, never in the repo).
6. Optional: bKash commission rate setting; Supabase Pro ($25/mo) so the project never pauses; custom domain.
7. Run Supabase security advisors after any schema change.

## Known limits to repeat to the owner
Unofficial approach, may breach bKash/Nagad terms (wallet freeze risk); SMS can be spoofed or delayed; phone must stay
on and unrestricted; Play Store will not allow SMS-reading apps (sideload only); official aggregators (e.g. SSLCOMMERZ)
are the safer long-term route.
