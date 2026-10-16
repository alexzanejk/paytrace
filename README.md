# PayTrace

Automatic payment verification for a Bangladesh business, from the SMS that bKash, Nagad, Rocket and Upay send.
An Android app forwards each payment SMS to a server, which reads it, stores it, and matches it to a customer's
order without ever crediting one payment twice.

**Setting things up yourself? Start with [docs/owner-setup.md](docs/owner-setup.md).**

## What is where

| Folder | What it is |
|---|---|
| `dashboard/` | Admin website. React + TypeScript + Vite, Tailwind, shadcn/ui. Built into `dist/`, hosted on Cloudflare Workers. |
| `android/` | The phone app. Kotlin + Jetpack Compose. Built by GitHub Actions into a signed APK. |
| `supabase/functions/ingest/` | The receiving endpoint: pairing, heartbeats, SMS reading, alerts. Runs on Supabase (Deno). |
| `supabase/migrations/` | Database history. Apply in filename order. |
| `tests/` | Automatic tests. Run all of them with `npm test`. |
| `scripts/` | `create-android-key.sh` (one-time app signing key), `run-tests.mjs`. |

## How a phone connects

Open the app. It shows a short code. Approve that code under **Devices** in the dashboard. Nothing is typed on the
phone, and a lost phone can be removed on its own. See `CLAUDE.md` for the design and the reasoning.

## Checks that run on every change

GitHub runs two workflows on each push (Actions tab):

- **CI**: all tests (`npm test`), builds the dashboard, and type-checks the server function.
- **Build Android APK**: builds the app signed with your permanent key if one is set up, and says which it used.
  Download it from the run's **Artifacts**, `paytrace-apk`.

## Secrets (never commit them)

This repository is **public**. Secrets live only in Supabase (Edge Function secrets) and GitHub (Actions secrets),
never in a file. See `CLAUDE.md` for the list.

## Run it locally

```
npm ci
npm test          # tests
npm run dev       # dashboard on your computer
npm run build     # what Cloudflare runs: npm ci && npm run build
```
