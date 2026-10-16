# Owner setup guide

Four things only you can do, because they need your accounts. Each takes about 10 minutes and none costs money
(except the optional one at the end). You can do them in any order. Ask Claude if any step is unclear.

---

## 1. Get alerts on your phone (Telegram, free)

You will be messaged when a payment is held for review, when a phone goes quiet, and when a phone can't capture payments.

1. In Telegram, search for **@BotFather** and send `/newbot`. Follow the questions (pick any name).
   It replies with a **token** that looks like `123456789:ABCdef...`. Keep it private.
2. Open your new bot in Telegram and press **Start**. (A bot cannot message you until you do.)
3. Find your **chat ID**: message **@userinfobot**. It replies with `Id: 123456789`.
4. Give both to PayTrace **without pasting them into any chat**. Either:
   - In Supabase: Edge Functions, then **Secrets**, then add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`, or
   - Tell Claude "I have my Telegram values" and Claude opens a secure box where only you type them.
5. In the dashboard open **Settings** and press **Send a test message**. It should arrive in seconds.
   If it says Telegram refused it, the token or chat ID is wrong, or you didn't press Start in step 2.

## 2. Make the permanent app key (one time)

Without this, every new version of the app must be uninstalled first, and the phone has to be approved again.
With it, a new version installs over the old one like a normal update.

You need Java on your computer. On a Mac, in Terminal: `brew install --cask temurin@17`.

1. Download this project (or ask Claude for the file), open Terminal in its folder, and run:
   `./scripts/create-android-key.sh`
2. It creates the key in a folder called `paytrace-signing` in your home folder, then helps you copy 4 values into
   GitHub, one at a time. It tells you exactly what to click.
3. **Back up the `paytrace-signing` folder** (password manager or a USB stick). If it is lost, every phone must be
   reinstalled once. Never email it or upload it anywhere else.
4. Go to the repository's **Actions** tab, run **Build Android APK**, and install the result on your phones.
   Uninstall the old app first this one last time. After that, updates install normally.

The build page tells you whether a build used your permanent key or a temporary one.

**If it says GitHub is signed in as a different account:** that is fine. Only the owner account (`alexzanejk`) may
store secrets, so the script skips the automatic route and shows you GitHub's web page instead. Paste the four
values there while signed in as the owner. If the key was made but not loaded, run
`bash scripts/create-android-key.sh --upload-only`. To copy one value at a time without showing it:
`bash scripts/create-android-key.sh --copy ANDROID_KEYSTORE_BASE64` (then the other three names).

## 3. Turn on two-step login for the dashboard (free)

1. Install an authenticator app on your phone that **backs itself up**: Google Authenticator (signed in to your
   Google account), Microsoft Authenticator, Authy or 1Password. This matters: if you lose the phone and the app
   doesn't back up, you are locked out.
2. In the dashboard open **Settings**, press **Set up two-step login**, scan the picture, type the 6-digit code.
3. From now on signing in asks for your password and a code. A stolen password alone no longer works.

If you ever lose access: ask Claude, or in Supabase's SQL editor run
`delete from auth.mfa_factors where user_id = '<your user id>';` and sign in with just your password again.

## 4. Optional, costs money: leaked-password check

Supabase can refuse any password that has appeared in a known leak. **This is only available on the Pro plan
($25 per month)**, so it is your call. Two-step login (step 3) protects you much more, and it is free.
If you ever upgrade for another reason (Pro also stops the project pausing when idle), turn it on under
Authentication, then Providers, then Email.

---

## If a payment message arrives while the phone is off

You don't need to do anything. Every 15 minutes, and whenever the app opens or the phone restarts, PayTrace looks
through the phone's own message inbox for payment messages it missed and sends them. It needs the **"Read SMS"**
permission: when the app first asks for SMS permissions, allow all of them. The phone's screen shows
"Inbox last checked ... Recovered N missed messages", and so does the Devices page. A phone that has been off for a
long time catches up with up to 7 days of messages.

## When the dashboard says a phone is Late or Silent

- **Late** (no word for 40+ minutes): usually Android delaying things. Open PayTrace on the phone.
- **Silent** (90+ minutes): payments sent to it may be missing. Check the phone is on, has internet, and PayTrace
  is open. On OnePlus, Xiaomi, Oppo, Vivo, Realme and Samsung also set PayTrace to "No restrictions" / "Autostart".
- The red strip also appears if **monitoring is switched off** or **SMS permission was removed**.
