# PayTrace OCR worker

Reads the TrxID out of payment screenshots posted in the owner's Telegram group. Runs on the owner's own VPS as a
small systemd service; everything else (receiving the messages, matching the TrxID to a stored transaction, the
dashboard page) lives in PayTrace's Supabase project and dashboard.

What it does, every few seconds:

1. asks the `telegram` edge function for photos still to read (`{"action":"ocr_next"}`),
2. downloads each photo through that same function (so the Telegram bot token never lives on the VPS),
3. prepares a few copies with ImageMagick (grey, doubled, inverted, thresholded) and runs Tesseract on each,
4. sends the text back (`{"action":"ocr_done"}`). The database decides which stored transaction, if any, it names.

It never matches, never pays, and writes nothing but the OCR text. Outbound connections only; nothing listens.

## Install (Ubuntu, as root)

```sh
curl -fsSL https://raw.githubusercontent.com/alexzanejk/paytrace/main/ocr-worker/setup.sh | bash
```

The script installs `nodejs`, `tesseract-ocr`, `imagemagick`, checks the repository out under `/opt/paytrace`, builds,
asks you to type the Supabase **service** key once (saved only in `/etc/paytrace-ocr.env`, mode 640), and starts the
service `paytrace-ocr` under its own user with a 600 MB memory cap. Run it again to update.

```sh
journalctl -u paytrace-ocr -f      # follow the log
systemctl restart paytrace-ocr     # restart
```

## Develop

```sh
npm ci && npm run build
SUPABASE_SERVICE_KEY=... node dist/index.js --once   # one pass, then exit
```

The TrxID reader (`src/candidates.ts`) is a copy of `supabase/functions/telegram/candidates.ts`; `tests/telegram.test.ts`
in the repository root fails if the two drift apart.
