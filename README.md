# PayTrace

Automatic bKash / Nagad / Rocket / Upay payment verification from SMS.

- `dashboard/` – admin web dashboard (static page, hosted on Cloudflare Workers via `wrangler.jsonc`, serving this folder)
- `supabase/functions/ingest/` – receiving endpoint + SMS parsers (Supabase Edge Function)
- `tests/` – parser tests (`node --experimental-strip-types tests/parser.test.ts`)
- `android/` – Android app (coming next)

Dashboard: React + Vite, built with `npm ci && npm run build` into `dist/`.

Phones connect by pairing: open the app, then approve the code it shows under Devices in the dashboard. No URL or secret is typed on the phone. The optional shared secret (INGEST_SECRET) lives only in Supabase; never commit it or build it into the APK.

## Android app
Source is in `android/`. GitHub Actions builds `app-debug.apk` on every change (Actions tab → latest run → Artifacts → `paytrace-apk`).
