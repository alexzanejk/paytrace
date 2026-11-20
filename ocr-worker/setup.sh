#!/usr/bin/env bash
# One-time setup of the PayTrace OCR worker on the owner's Ubuntu VPS (step 3). Run as root in the droplet's web console:
#   curl -fsSL https://raw.githubusercontent.com/alexzanejk/paytrace/main/ocr-worker/setup.sh | bash
# It installs Node.js, Tesseract and ImageMagick from Ubuntu's own packages, checks out this repository under
# /opt/paytrace, builds the worker, asks you to TYPE the Supabase service key (hidden, saved only in
# /etc/paytrace-ocr.env, readable by root and the worker's user), and starts it as a systemd service under its own
# user with a memory cap. It touches nothing else on the machine: no port, no other service, no other user.
# Running it again is safe (it updates and restarts).
set -euo pipefail

REPO="https://github.com/alexzanejk/paytrace.git"
DIR="/opt/paytrace"
ENV_FILE="/etc/paytrace-ocr.env"
USER_NAME="paytrace"

if [ "$(id -u)" -ne 0 ]; then echo "Run this as root (sudo)."; exit 1; fi

echo "== packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git nodejs npm tesseract-ocr tesseract-ocr-eng imagemagick >/dev/null
echo "node $(node --version), npm $(npm --version), $(tesseract --version 2>&1 | head -1), $(convert -version | head -1)"

echo "== user"
id -u "$USER_NAME" >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/paytrace --shell /usr/sbin/nologin "$USER_NAME"

echo "== code"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull -q --ff-only; else git clone -q --depth 1 "$REPO" "$DIR"; fi
cd "$DIR/ocr-worker"
npm ci --silent
npm run build --silent
chown -R "$USER_NAME:$USER_NAME" "$DIR/ocr-worker"

echo "== the one secret"
if [ ! -s "$ENV_FILE" ] || ! grep -q '^SUPABASE_SERVICE_KEY=.\+' "$ENV_FILE"; then
  echo "Paste the Supabase SERVICE key (Supabase dashboard > Project Settings > API > service_role). It is not shown while you type."
  read -r -s -p "SUPABASE_SERVICE_KEY: " KEY; echo
  if [ -z "$KEY" ]; then echo "No key given; stopping. Run the script again when you have it."; exit 1; fi
  umask 077
  printf 'SUPABASE_SERVICE_KEY=%s\nPAYTRACE_FUNCTION_URL=https://mkjcqwkfbamnuibmurcd.supabase.co/functions/v1/telegram\nOCR_POLL_SECONDS=5\n' "$KEY" > "$ENV_FILE"
  chown root:"$USER_NAME" "$ENV_FILE"; chmod 640 "$ENV_FILE"
else
  echo "keeping the existing $ENV_FILE"
fi

echo "== service"
install -m 644 "$DIR/ocr-worker/paytrace-ocr.service" /etc/systemd/system/paytrace-ocr.service
systemctl daemon-reload
systemctl enable -q paytrace-ocr
systemctl restart paytrace-ocr
sleep 2
systemctl --no-pager --lines=5 status paytrace-ocr || true
echo
echo "Done. Follow it with:  journalctl -u paytrace-ocr -f"
echo "Update later with:     curl -fsSL https://raw.githubusercontent.com/alexzanejk/paytrace/main/ocr-worker/setup.sh | bash"
