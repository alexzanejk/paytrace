#!/usr/bin/env bash
# Tests scripts/create-android-key.sh with stand-ins for `gh` and the clipboard. Needs Java (keytool). Not run in CI.
# Usage: bash scripts/test-create-android-key.sh
set -uo pipefail
SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/create-android-key.sh"
pass=0; fail=0
ok() { if eval "$2"; then pass=$((pass+1)); echo "  ok   $1"; else fail=$((fail+1)); echo "  FAIL $1"; fi; }

new_env() { # $1 = admin|notadmin|none ; SECRET_OK=ok|fail decides whether `gh secret set` works
  T=$(mktemp -d); mkdir -p "$T/bin" "$T/home"; export HOME="$T/home"; export PAYTRACE_KEY_DIR="$T/key"
  export GH_LOG="$T/gh.log"; : > "$GH_LOG"; export CLIP="$T/clip"; : > "$CLIP"
  # fake `gh`
  if [ "$1" != none ]; then
  cat > "$T/bin/gh" <<GH
#!/usr/bin/env bash
if [ "\$1" = auth ]; then exit 0; fi
if [ "\$1" = api ] && [ "\$2" = user ]; then echo ashkawser5-dev; exit 0; fi
if [ "\$1" = api ]; then [ "$1" = admin ] && echo true || echo false; exit 0; fi
if [ "\$1" = secret ]; then cat >/dev/null; echo "set \$3" >> "$GH_LOG"; [ "$SECRET_OK" = ok ] || exit 1; exit 0; fi
GH
  chmod +x "$T/bin/gh"; fi
  # fake clipboard
  printf '#!/usr/bin/env bash\ncat > "%s"\n' "$CLIP" > "$T/bin/pbcopy"; chmod +x "$T/bin/pbcopy"
  export PATH="$T/bin:$ORIG_PATH"
}
ORIG_PATH="$PATH"

echo "== T1: logged in as the WRONG account (the situation on the owner's Mac) =="
SECRET_OK=ok new_env notadmin
OUT=$(bash "$SCRIPT" </dev/null 2>&1); RC=$?
ok "script finishes cleanly (exit 0)" "[ $RC -eq 0 ]"
ok "it names the wrong account" "echo \"\$OUT\" | grep -q \"signed in as 'ashkawser5-dev'\""
ok "it does NOT try to save secrets with that account" "[ ! -s \"$GH_LOG\" ]"
ok "it points at the web page for the owner" "echo \"\$OUT\" | grep -q 'settings/secrets/actions/new'"
ok "with no terminal it lists the per-secret copy commands" "echo \"\$OUT\" | grep -q -- '--copy ANDROID_KEYSTORE_BASE64'"
PW=$(grep '^ANDROID_KEYSTORE_PASSWORD=' "$PAYTRACE_KEY_DIR/passwords.txt" | cut -d= -f2-)
B64=$(base64 < "$PAYTRACE_KEY_DIR/paytrace-release.jks" | tr -d '\n' | cut -c1-40)
ok "the password never appears on screen" "! echo \"\$OUT\" | grep -qF \"$PW\""
ok "the key file contents never appear on screen" "! echo \"\$OUT\" | grep -qF \"$B64\""
ok "key folder is private (700)" "[ \"\$(stat -c %a \"$PAYTRACE_KEY_DIR\" 2>/dev/null || stat -f %Lp \"$PAYTRACE_KEY_DIR\")\" = 700 ]"
ok "key and password files are private (600)" "[ \"\$(stat -c %a \"$PAYTRACE_KEY_DIR/paytrace-release.jks\")\" = 600 ] && [ \"\$(stat -c %a \"$PAYTRACE_KEY_DIR/passwords.txt\")\" = 600 ]"

echo "== T1b: ...then copying one secret at a time =="
RC=0; OUT2=$(bash "$SCRIPT" --copy ANDROID_KEY_ALIAS 2>&1) || RC=$?
ok "--copy works" "[ $RC -eq 0 ]"
ok "the alias (not secret) is what landed on the clipboard" "[ \"\$(cat \"$CLIP\")\" = paytrace ]"
bash "$SCRIPT" --copy ANDROID_KEYSTORE_PASSWORD >/dev/null 2>&1
ok "the password reached the clipboard (40 chars)" "[ \$(wc -c < \"$CLIP\") -eq 40 ]"
OUT3=$(bash "$SCRIPT" --copy ANDROID_KEYSTORE_PASSWORD 2>&1)
ok "--copy never prints the value" "! echo \"\$OUT3\" | grep -qF \"$PW\""
bash "$SCRIPT" --copy ANDROID_KEYSTORE_BASE64 >/dev/null 2>&1
ok "the key file (base64) reached the clipboard, on one line" "[ \$(wc -c < \"$CLIP\") -gt 1000 ] && [ \$(wc -l < \"$CLIP\") -eq 0 ]"
RC=0; bash "$SCRIPT" --copy BOGUS >/dev/null 2>&1 || RC=$?
ok "an unknown secret name is refused" "[ $RC -ne 0 ]"

echo "== T1c: running it again must refuse, and say how to continue =="
RC=0; OUT4=$(bash "$SCRIPT" </dev/null 2>&1) || RC=$?
ok "second run refuses to overwrite the key" "[ $RC -ne 0 ] && echo \"\$OUT4\" | grep -q 'already exists'"
ok "and points at --upload-only" "echo \"\$OUT4\" | grep -q -- '--upload-only'"
ok "the original key is untouched (password unchanged)" "[ \"\$(grep '^ANDROID_KEYSTORE_PASSWORD=' \"$PAYTRACE_KEY_DIR/passwords.txt\" | cut -d= -f2-)\" = \"$PW\" ]"

echo "== T2: logged in as the OWNER (admin): saves all 4 itself =="
SECRET_OK=ok new_env admin
OUT=$(bash "$SCRIPT" </dev/null 2>&1); RC=$?
ok "exit 0" "[ $RC -eq 0 ]"
ok "all four secrets saved through gh, by name, no more no less" "[ \$(wc -l < \"$GH_LOG\") -eq 4 ] && for n in ANDROID_KEYSTORE_BASE64 ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD; do grep -qx \"set \$n\" \"$GH_LOG\" || exit 1; done"
PW=$(grep '^ANDROID_KEYSTORE_PASSWORD=' "$PAYTRACE_KEY_DIR/passwords.txt" | cut -d= -f2-)
ok "no secret value on screen" "! echo \"\$OUT\" | grep -qF \"$PW\""

echo "== T3: admin, but saving fails: falls back instead of stopping =="
SECRET_OK=fail new_env admin
OUT=$(bash "$SCRIPT" </dev/null 2>&1); RC=$?
ok "still exits 0 (does not abort with the key half-uploaded)" "[ $RC -eq 0 ]"
ok "tells the owner to use the web page" "echo \"\$OUT\" | grep -q 'web page route'"
ok "key exists and can be uploaded later" "[ -e \"$PAYTRACE_KEY_DIR/paytrace-release.jks\" ]"

echo "== T4: --upload-only picks up an existing key =="
SECRET_OK=ok new_env admin
PAYTRACE_NO_UPLOAD=1 bash "$SCRIPT" >/dev/null 2>&1
: > "$GH_LOG"
OUT=$(bash "$SCRIPT" --upload-only </dev/null 2>&1); RC=$?
ok "exit 0, all four saved" "[ $RC -eq 0 ] && [ \$(wc -l < \"$GH_LOG\") -eq 4 ]"
ok "it did not make a new key" "! echo \"\$OUT\" | grep -q 'Key created'"
SECRET_OK=ok new_env admin
RC=0; bash "$SCRIPT" --upload-only >/dev/null 2>&1 || RC=$?
ok "--upload-only with no key errors out" "[ $RC -ne 0 ]"

echo "== T5: no gh at all =="
SECRET_OK=ok new_env none
OUT=$(bash "$SCRIPT" </dev/null 2>&1); RC=$?
ok "works without the GitHub command line (exit 0, web page route)" "[ $RC -eq 0 ] && echo \"\$OUT\" | grep -q 'settings/secrets/actions/new'"

echo; echo "$pass passed, $fail failed"; exit $((fail>0))
