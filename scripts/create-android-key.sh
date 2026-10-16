#!/usr/bin/env bash
# One-time setup: make PayTrace's permanent Android signing key and load it into GitHub.
#
# Why: Android only installs an update over an existing app if both are signed with the SAME key.
# Without a permanent key, every new build has a different signature and you must uninstall first.
#
# The key is never put in the repository. It is made on YOUR computer, kept in ~/paytrace-signing, and
# copied into GitHub's encrypted "Secrets" so the build can use it.
#
# Needs: Java (the `keytool` command). On a Mac:  brew install --cask temurin@17
set -euo pipefail

DIR="${PAYTRACE_KEY_DIR:-$HOME/paytrace-signing}"
REPO="${PAYTRACE_REPO:-alexzanejk/paytrace}"
JKS="$DIR/paytrace-release.jks"

command -v keytool >/dev/null 2>&1 || {
  echo "Java is needed, but the 'keytool' command was not found."
  echo "Mac:  brew install --cask temurin@17     (or ask Claude to walk you through it)"
  exit 1
}
command -v openssl >/dev/null 2>&1 || { echo "openssl is needed but was not found."; exit 1; }

if [ -e "$JKS" ]; then
  echo "A key already exists at $JKS"
  echo "Not making a new one: replacing it would stop updates installing on every phone."
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
umask 077
printf 'ANDROID_KEYSTORE_PASSWORD=%s\nANDROID_KEY_ALIAS=%s\nANDROID_KEY_PASSWORD=%s\n' "$PW" "$ALIAS" "$PW" > "$DIR/passwords.txt"
KS_B64="$(base64 < "$JKS" | tr -d '\n')"

echo
echo "Key created in: $DIR"
echo "BACK UP THAT FOLDER somewhere safe (password manager, USB stick). If it is lost, every phone must be"
echo "reinstalled once. Never share it and never upload it anywhere except as the GitHub secrets below."
echo

if [ "${PAYTRACE_NO_UPLOAD:-}" = "1" ]; then
  echo "(upload skipped)"; exit 0
fi

put_secret() { # name value
  local name="$1" value="$2"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    printf '%s' "$value" | gh secret set "$name" --repo "$REPO" >/dev/null
    echo "  saved $name to GitHub"
    return
  fi
  local copy=""
  command -v pbcopy >/dev/null 2>&1 && copy="pbcopy"
  [ -z "$copy" ] && command -v xclip >/dev/null 2>&1 && copy="xclip -selection clipboard"
  if [ -z "$copy" ]; then
    echo "No clipboard tool found, so nothing was copied. The values are in $DIR/passwords.txt"
    echo "(and the key file as base64: run  base64 < $JKS | tr -d '\\n'  )."
    return
  fi
  printf '%s' "$value" | $copy
  echo "  $name is now on your clipboard."
  echo "  In GitHub: New repository secret -> Name: $name -> paste -> Add secret."
  read -r -p "  Press Enter when done, to copy the next one... " _
}

SECRETS_URL="https://github.com/$REPO/settings/secrets/actions/new"
if ! { command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; }; then
  echo "Open this page in your browser, you will add 4 secrets there, one at a time:"
  echo "  $SECRETS_URL"
  echo
fi
put_secret ANDROID_KEYSTORE_BASE64 "$KS_B64"
put_secret ANDROID_KEYSTORE_PASSWORD "$PW"
put_secret ANDROID_KEY_ALIAS "$ALIAS"
put_secret ANDROID_KEY_PASSWORD "$PW"

echo
echo "Done. The next Android build will use this key. Install that one build over your phones"
echo "(uninstall the old app first, one last time); every build after it installs as a normal update."
