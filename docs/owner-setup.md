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

## 5. Let your website check transaction IDs

Your website's admin and super-admin servers can ask PayTrace whether a customer's transaction ID really arrived, and
for how much. Everything is done on the dashboard, nothing is typed into Supabase:

1. Open the dashboard and go to **API access**.
2. Type the name of the server (for example "Website admin") and press **Make key**. Do this once per server.
3. The key is shown **once**. Press **Copy key**, or **Copy instructions with this key**, and send it to your developer
   privately. If it is lost, revoke it and make a new one: PayTrace keeps only a scrambled version and cannot show it again.
4. Press **Copy instructions for the developer** (no key inside) to give them the endpoint and what to show for each
   answer. **Copy endpoint** copies just the address.
5. To stop a server (or if a key leaks), press **Revoke** next to its key. It stops working immediately. The list shows
   when each key was last used.

The developer's guide is also in `docs/verify-api.md`.

## If a payment message arrives while the phone is off

You don't need to do anything. Every 15 minutes (and when the app opens or the phone restarts) PayTrace looks
through the phone's own message inbox for payment messages it missed and sends them. It needs the **"Read SMS"**
permission: when the app first asks for SMS permissions, allow all of them. The phone's screen shows
"Inbox last checked ... Recovered N missed messages", and so does the Phones page. A phone that has been off for a
long time catches up with up to 7 days of messages.

## When the dashboard says a phone is Offline

Each phone tells the dashboard "I'm online" every 30 seconds. If three in a row are missed (about a minute and a half),
the phone shows **Offline** and a red strip appears on every page. If it stays offline for 3 minutes, you also get a
Telegram message (once set up). The dashboard cannot tell *why* a phone is offline: switched off, battery dead, no
internet, or the app was stopped all look the same.

- Check the phone is on, has internet, and PayTrace is open. Payments sent to it may be missing meanwhile.
- **A phone that goes offline when its screen turns off** (and comes back when you wake it) is being stopped by the
  phone brand's own battery manager. Allowing "no battery limit" is not enough on Vivo, OnePlus, Oppo, Realme, Xiaomi
  and Samsung. The app's setup page lists the extra steps for your brand, and the app's first screen repeats them
  under "Does this phone keep going offline?". For **Vivo**: Settings > Battery > Background power consumption
  management > PayTrace > "Allow high background power consumption", turn on Autostart, and lock PayTrace in the
  recent-apps screen. For **OnePlus**: Battery optimization > Don't optimize, App > Battery usage > Allow background
  activity, switch off "Sleep standby optimization" and "Deep optimization", and lock PayTrace in recent apps.
- **One-tap settings:** on Vivo, iQOO, OnePlus, Oppo, Realme, Xiaomi, Huawei, Samsung, Tecno, Infinix and itel phones,
  the setup page and the app's first screen have an **Open the autostart page** button that jumps straight to your
  phone brand's own page, so you don't have to hunt through menus. If a model doesn't have that page, it opens
  PayTrace's normal settings page instead.
- **Messages waiting to send** are now sent the moment the phone's internet comes back, instead of waiting up to
  15 minutes. The dashboard hears from the phone at the same moment.
- **SMS app mode (optional, for phones used only for payments):** on the app's first screen, tap **Turn on SMS app mode**.
  PayTrace becomes the phone's messaging app. Android sends it every message first and phone brands almost never stop the
  messaging app, so payment messages keep arriving with the screen off. The app then has a **Messages** tab where you can
  read conversations, reply, send new text messages, and mark messages as seen (opening a conversation marks it as read;
  notifications also have a **Mark as read** button). The trade-off: picture messages (MMS, group pictures) are not
  supported, so a phone in this mode will not receive them. Other messages (bank codes, friends) still arrive as
  notifications from PayTrace. The first time you send, Android asks to allow sending messages. To go back, tap **Choose
  another messaging app** and pick Google Messages. The Phones page shows "SMS app mode" for phones that use it.
- **The first time you finish setup**, the app asks once "Make PayTrace this phone's SMS app?". Say **Yes** on phones used for
  payments. If you say "Not now", a reminder with the same button stays at the top of the first screen.
- **Extra-strong keep-alive** (Settings tab, on by default): a backup alarm every 5 minutes that phone brands almost never
  cancel, so PayTrace is restarted if the phone stops it. It shows a small alarm icon in the status bar and may show
  "next alarm" on the lock screen. PayTrace's notice is now shown normally in the status bar (no sound), and comes back
  straight away if someone swipes it away.
- The Phones page shows "The phone stopped PayTrace N times (last time for X min)" when this has happened, so you can
  see whether the settings fixed it (the number should stop growing).
- When you first open the app, it shows a **setup page** that lists every permission and setting it needs (read and
  receive SMS, notifications, "run in the background without limits", and on Vivo, OnePlus, Oppo, Xiaomi, Samsung and
  similar phones, "auto-start"). The app stays locked until all are done. If one is later switched off, the app's
  notification says "Action needed".
- Keep the phone **plugged in**: checking in every 30 seconds uses more battery than before.
- The red strip also appears if **monitoring is switched off** or **SMS permission was removed**.
- The free Supabase plan covers about 5 phones at this check-in rate. More than that would need the paid plan; ask first.
