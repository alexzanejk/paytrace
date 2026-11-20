#!/usr/bin/env bash
# One-time setup of the PayTrace OCR worker on the owner's Ubuntu VPS (step 3). Run as root in the droplet's web console:
#   curl -fsSL https://raw.githubusercontent.com/alexzanejk/paytrace/main/ocr-worker/setup.sh | bash
# It installs Node.js, Tesseract and ImageMagick from Ubuntu's own packages, checks out this repository under
# /opt/paytrace, builds the worker, asks you to TYPE the Supabase service key (hidden, saved only in
# /etc/paytrace-ocr.env, readable by root and the worker's user), and starts it as a systemd service under its own
# user with a memory cap. It touches nothing else on the machine: no port, no other service, no other user.
# Running it again is safe (it updates and restarts). `bash setup.sh --check` only looks and prints; it changes nothing.
set -euo pipefail

REPO="https://github.com/alexzanejk/paytrace.git"
DIR="/opt/paytrace"
ENV_FILE="/etc/paytrace-ocr.env"
USER_NAME="paytrace"

if [ "$(id -u)" -ne 0 ]; then echo "Run this as root (sudo)."; exit 1; fi

# --check: look, change nothing. Prints what the worker would need and what already runs here, so the output can be
# read BEFORE anything is installed on a machine that also runs something else (the owner's game-provider proxy).
if [ "${1:-}" = "--check" ]; then
  echo "== machine";  . /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"; uname -m; nproc; free -h | sed -n 1,2p; df -h / | tail -1
  echo "== tools already here (missing ones would be installed from Ubuntu's own packages; present ones are left as they are)"
  for c in git node npm tesseract convert; do if command -v "$c" >/dev/null 2>&1; then echo "  $c: $(command -v "$c") $("$c" --version 2>&1 | head -1)"; else echo "  $c: missing"; fi; done
  echo "== what listens on the network (the worker opens no port)"; ss -ltnp 2>/dev/null | sed -n 1,30p
  echo "== services running"; systemctl list-units --type=service --state=running --no-pager --no-legend | awk '{print "  " $1}' | sed -n 1,40p
  echo "== PayTrace worker"; [ -d "$DIR" ] && echo "  $DIR exists" || echo "  not installed yet"; id "$USER_NAME" >/dev/null 2>&1 && echo "  user $USER_NAME exists" || echo "  user $USER_NAME not yet"; [ -s "$ENV_FILE" ] && echo "  $ENV_FILE exists" || echo "  no key saved yet"
  echo "== done, nothing was changed"
  exit 0
fi

echo "== packages (only the missing ones; nothing already on the machine is upgraded or replaced)"
export DEBIAN_FRONTEND=noninteractive
MISSING=""
command -v git >/dev/null 2>&1 || MISSING="$MISSING git"
command -v node >/dev/null 2>&1 || MISSING="$MISSING nodejs"
command -v npm >/dev/null 2>&1 || MISSING="$MISSING npm"
command -v tesseract >/dev/null 2>&1 || MISSING="$MISSING tesseract-ocr tesseract-ocr-eng"
command -v convert >/dev/null 2>&1 || MISSING="$MISSING imagemagick"
if [ -n "$MISSING" ]; then
  echo "installing:$MISSING"
  apt-get update -qq
  # shellcheck disable=SC2086
  apt-get install -y -qq --no-install-recommends --no-upgrade $MISSING >/dev/null
else
  echo "everything needed is already here"
fi
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
  # From the keyboard, not from the pipe: with `curl ... | bash` the script itself is on stdin.
  read -r -s -p "SUPABASE_SERVICE_KEY: " KEY < /dev/tty; echo
  if [ -z "$KEY" ]; then echo "No key given; stopping. Run the script again when you have it."; exit 1; fi
  umask 077
  printf 'SUPABASE_SERVICE_KEY=%s\nPAYTRACE_FUNCTION_URL=https://mkjcqwkfbamnuibmurcd.supabase.co/functions/v1/telegram\nOCR_POLL_SECONDS=5\n' "$KEY" > "$ENV_FILE"
  chown root:"$USER_NAME" "$ENV_FILE"; chmod 640 "$ENV_FILE"
else
  echo "keeping the existing $ENV_FILE"
fi

echo "== service"
# The unit names /usr/bin/node; on a machine whose node lives elsewhere (nvm, /opt), the real path is written in.
sed "s#/usr/bin/node#$(command -v node)#" "$DIR/ocr-worker/paytrace-ocr.service" > /etc/systemd/system/paytrace-ocr.service
chmod 644 /etc/systemd/system/paytrace-ocr.service
systemctl daemon-reload
systemctl enable -q paytrace-ocr
systemctl restart paytrace-ocr
sleep 2
systemctl --no-pager --lines=5 status paytrace-ocr || true
echo
echo "Done. Follow it with:  journalctl -u paytrace-ocr -f"
echo "Update later with:     curl -fsSL https://raw.githubusercontent.com/alexzanejk/paytrace/main/ocr-worker/setup.sh | bash"
