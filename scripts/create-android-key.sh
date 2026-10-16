#!/usr/bin/env bash
# One-time setup: make PayTrace's permanent Android signing key and load it into GitHub.
#
# Why: Android only installs an update over an existing app if both are signed with the SAME key.
# Without a permanent key, every new build has a different signature and you must uninstall first.
#
# The key is never put in the repository. It is made on YOUR computer, kept in ~/paytrace-signing, and
# copied into GitHub's encrypted "Secrets" so the build can use it. Secret values are never printed.
#
# Usage:
#   bash scripts/create-android-key.sh                 make the key, then load it into GitHub
#   bash scripts/create-android-key.sh --upload-only   the key exists already; just load it into GitHub
#   bash scripts/create-android-key.sh --copy NAME     put ONE secret on the clipboard (shows nothing)
#
# Needs: Java (the `keytool` command). On a Mac:  brew install --cask temurin@17
set -euo pipefail

DIR="${PAYTRACE_KEY_DIR:-$HOME/paytrace-signing}"
REPO="${PAYTRACE_REPO:-alexzanejk/paytrace}"
JKS="$DIR/paytrace-release.jks"
PASSFILE="$DIR/passwords.txt"
SECRETS_URL="https://github.com/$REPO/settings/secrets/actions/new"
NAMES=(ANDROID_KEYSTORE_BASE64 ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD)

die() { echo "$*" >&2; exit 1; }

# The value of one secret, read from the files in $DIR. Printed to stdout: only ever pipe it somewhere.
value_of() {
  case "$1" in
    ANDROID_KEYSTORE_BASE64) base64 < "$JKS" | tr -d '\n' ;;
    ANDROID_KEYSTORE_PASSWORD | ANDROID_KEY_ALIAS | ANDROID_KEY_PASSWORD) grep "^$1=" "$PASSFILE" | cut -d= -f2- ;;
    *) echo "unknown secret name: $1" >&2; return 1 ;;
  esac
}

clipboard_cmd() {
  if command -v pbcopy >/dev/null 2>&1; then echo "pbcopy"
  elif command -v wl-copy >/dev/null 2>&1; then echo "wl-copy"
  elif command -v xclip >/dev/null 2>&1; then echo "xclip -selection clipboard"
  else return 1; fi
}

need_key_files() {
  [ -e "$JKS" ] && [ -e "$PASSFILE" ] || die "No key found in $DIR. Run this script without options first to make one."
}

# ---------- --copy NAME: one secret to the clipboard, nothing printed ----------
if [ "${1:-}" = "--copy" ]; then
  name="${2:-}"; [ -n "$name" ] || die "Usage: $0 --copy NAME   (one of: ${NAMES[*]})"
  need_key_files
  cp="$(clipboard_cmd)" || die "No clipboard tool found on this computer."
  value_of "$name" | tr -d '\n' | $cp
  echo "$name is on your clipboard. In GitHub: New repository secret -> Name: $name -> paste -> Add secret."
  exit 0
fi

UPLOAD_ONLY=0
[ "${1:-}" = "--upload-only" ] && UPLOAD_ONLY=1
[ -z "${1:-}" ] || [ "$UPLOAD_ONLY" = 1 ] || die "Unknown option: $1"

# ---------- make the key ----------
if [ "$UPLOAD_ONLY" = 1 ]; then
  need_key_files
  echo "Using the existing key in $DIR"
else
  command -v keytool >/dev/null 2>&1 || {
    echo "Java is needed, but the 'keytool' command was not found." >&2
    echo "Mac:  brew install --cask temurin@17     (or ask Claude to walk you through it)" >&2
    exit 1
  }
  command -v openssl >/dev/null 2>&1 || die "openssl is needed but was not found."

  if [ -e "$JKS" ]; then
    echo "A key already exists at $JKS" >&2
    echo "Not making a new one: replacing it would stop updates installing on every phone." >&2
    echo "If the key was made but never loaded into GitHub, run:  bash $0 --upload-only" >&2
    exit 1
  fi

  mkdir -p "$DIR"; chmod 700 "$DIR"
  PW="$(openssl rand -hex 20)"
  ALIAS="paytrace"
  export PAYTRACE_STOREPASS="$PW"
  keytool -genkeypair -keystore "$JKS" -storetype PKCS12 -alias "$ALIAS" -keyalg RSA -keysize 2048 \
    -validity 10000 -storepass:env PAYTRACE_STOREPASS -dname "CN=PayTrace, O=PayTrace, C=BD" >/dev/null
  chmod 600 "$JKS"

  # The same details, kept next to the key as your backup.
  ( umask 077; printf 'ANDROID_KEYSTORE_PASSWORD=%s\nANDROID_KEY_ALIAS=%s\nANDROID_KEY_PASSWORD=%s\n' "$PW" "$ALIAS" "$PW" > "$PASSFILE" )
  chmod 600 "$PASSFILE"

  echo
  echo "Key created in: $DIR"
  echo "BACK UP THAT FOLDER somewhere safe (password manager, USB stick). If it is lost, every phone must be"
  echo "reinstalled once. Never share it and never upload it anywhere except as the GitHub secrets below."
  echo
fi

if [ "${PAYTRACE_NO_UPLOAD:-}" = "1" ]; then
  echo "(upload skipped)"; exit 0
fi

# ---------- load it into GitHub ----------
# Being logged in to the GitHub command line is not enough: the account must be allowed to manage this
# repository's secrets (an admin). A different account would create the key and then fail to save it.
gh_can_manage() {
  command -v gh >/dev/null 2>&1 || return 1
  gh auth status >/dev/null 2>&1 || return 1
  [ "$(gh api "repos/$REPO" --jq '.permissions.admin' 2>/dev/null || true)" = "true" ]
}

manual_route() {
  echo "Add the 4 secrets on GitHub's web page, one at a time, while signed in as ${REPO%%/*} (the repository owner):"
  echo "  $SECRETS_URL"
  echo "Their names: ${NAMES[*]}"
  echo
  if [ -t 0 ] && cp="$(clipboard_cmd)"; then
    for n in "${NAMES[@]}"; do
      value_of "$n" | tr -d '\n' | $cp
      echo "  $n is now on your clipboard. GitHub: Name = $n -> paste into Secret -> Add secret."
      read -r -p "  Press Enter when done, to copy the next one... " _
    done
  else
    echo "Run these one at a time. Each copies ONE secret to your clipboard and shows nothing:"
    for n in "${NAMES[@]}"; do echo "  bash $0 --copy $n"; done
  fi
}

if gh_can_manage; then
  failed=0
  for n in "${NAMES[@]}"; do
    if value_of "$n" | gh secret set "$n" --repo "$REPO" >/dev/null 2>&1; then
      echo "  saved $n to GitHub"
    else
      echo "  could not save $n with the GitHub command line"
      failed=1
    fi
  done
  if [ "$failed" = 1 ]; then
    echo
    echo "Not everything could be saved automatically, so use the web page route instead (all 4, to be safe)."
    manual_route
    exit 0
  fi
else
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    who="$(gh api user --jq .login 2>/dev/null || echo "another account")"
    echo "The GitHub command line is signed in as '$who', which is not allowed to manage secrets for $REPO."
    echo "That is fine: use the web page below, where you are signed in as the owner."
    echo
  fi
  manual_route
fi

echo
echo "Done. After all 4 secrets are saved, the next Android build uses this key. Install that one build on your"
echo "phones (uninstall the old app first, one last time); every build after it installs as a normal update."
