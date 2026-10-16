# PayTrace

Automatic bKash / Nagad / Rocket / Upay payment verification from SMS.

- `dashboard/` – admin web dashboard (static page, host on Cloudflare Pages; publish folder `dashboard`)
- `supabase/functions/ingest/` – receiving endpoint + SMS parsers (Supabase Edge Function)
- `tests/` – parser tests (`node --experimental-strip-types tests/parser.test.ts`)
- `android/` – Android app (coming next)

Secrets (INGEST_SECRET) live only in Supabase and the phone app. Never commit them.
