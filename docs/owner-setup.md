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

1. Open the dashboard and go to **Websites** (formerly API access).
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

## Step 6: Wake-up messages from Firebase (optional, free, for phones that keep getting stopped)

Some phone brands (Vivo, Oppo, Xiaomi and others) stop PayTrace when the screen is off. Firebase is Google's free
message service. With it set up, when the server notices a phone has gone quiet (about 100 seconds) it sends that phone a
high-priority wake-up message, and Android starts PayTrace again. It is not a guarantee: if the phone's own settings fully
block the app (autostart off, app force-stopped), the message is blocked too, so keep the battery steps above done.

1. Go to the Firebase website, sign in with your Google account, and **Add project** (any name, for example "PayTrace";
   you can turn Google Analytics off).
2. In the project, tap the Android icon to **Add app**. Android package name: `com.paytrace.app`. Skip the other fields.
3. Download **google-services.json** from that screen. In your GitHub repository go to Settings > Secrets and variables >
   Actions > **New repository secret**. Name: `GOOGLE_SERVICES_JSON`. Value: open the downloaded file in a text editor,
   copy everything and paste it. (This file is not a password, but it is kept out of the public code.)
4. In Firebase: Project settings (gear icon) > **Service accounts** > **Generate new private key**. This downloads a file
   that **is** a password. Do not send it to anyone, and do not paste it in chat. Tell Claude "ready for the key", and a
   private box will open in which you paste the file's whole text; only the server stores it (name:
   `FIREBASE_SERVICE_ACCOUNT`).
5. Build the app again (any change to the app, or "Run workflow" on the Build Android APK page) and install it on the
   phones. The run summary should say "Firebase wake-up pushes: **included**". Each phone's card on the Phones page shows
   "Wake-up messages: ready" once it has registered.

## The phone-settings guide in the app

On first opening, and under **Settings → Keep this phone running**, the app walks through the phone settings for your brand,
**in Bangla first** (a **বাংলা | English** switch at the top changes it and the phone remembers the choice; every Bangla line is listed in
`docs/guide-bangla.md` for proofreading), one card each: **Where** to find it, what to **Choose**, what **Not** to choose. Menu and option names stay in English inside quotes (the phone's own screens are usually in English); Bangla explains around them.

- **Open this page** opens the right screen. If it opens the wrong screen, or nothing, tap **Not the right page? Try another**: the app
  moves to the next place (the phone brand's own page, then Android's page, then PayTrace's own app page, then the phone's Settings,
  which every phone has). It always tells you which page it opened.
- **Phone check** (top of the guide) shows what Android itself reports: battery optimisation, background limit and app standby. Cards
  about battery optimisation tick themselves ("The phone confirms this one") once it is really off. Other cards you tick yourself with
  **I did this**, because phone brands hide those settings from apps.
- **Screen-off test** (bottom) proves it works: press **Start the 10-minute test**, lock the phone and leave it. When you open PayTrace
  again it says **Passed** (PayTrace never went quiet with the screen off) or **Failed** (the phone stopped it: do the cards again).
  The result also appears on the dashboard's Phones page ("Screen-off test passed" or a warning), so you can see which phones are proven.

Example (Vivo): Settings → Battery → Background power consumption management → PayTrace → choose **Allow high background power
consumption**, not "Optimized". The app stays on the setup page until every card is done.


## Step 7: Accept deposits on your websites

1. **Phones tab:** on each phone press **Add a number**, choose the provider, type the wallet number that phone receives money
   on, and choose how customers pay it: *Customer sends money*, or *Customer cashes out at this agent*. You can switch a number
   off without deleting it. Customers are only ever shown numbers from phones you approved.
2. **Websites tab:** press "Add website and make key" and copy the key. Then on that website's card set its result address and result page look.
3. In **Where to send payment results**, pick that key and type the https address on your website that should receive "paid"
   messages. Copy the signing secret that appears (shown once) and give it to your developer.
4. Press **Copy deposit instructions for the developer** and send them, with the key, to whoever builds your site.
5. Try it with a small real amount: the developer creates an order, you open the pay link on your phone, pay, paste the TrxID.
   The order should show as paid in the **Orders** tab (source: *Website deposit*).

Held payments (wrong amount, wrong phone, late) show in **Review**; approve them by hand once you have checked.

Optional: on a website's card on the **Websites** tab, "How should this site's result page look?" lets you pick how the screen after Confirm looks (six
looks). Leave it on Automatic and every site gets its own look. "Preview the looks" shows them all.


## Step 8: Partner commission (people who provide bKash, Nagad, Rocket or Upay accounts)

A partner is a person whose phone (running the PayTrace app) receives money for you through their agent account (Cash Out) or
personal account (Send Money). They earn a **percentage of the day's total** that comes through their phone. PayTrace only
records and calculates this; **you pay partners yourself** and record the payout.

1. **Phones tab → the partner's phone → Partner commission.** Type the percentage for each provider (bKash, Nagad, Rocket, Upay)
   and each kind: **Cash Out (agent account)** and **Send Money (personal account)**. Leave a box empty to keep its rate, type 0 for
   none. Pick the day the new rates start (default today); earlier days keep the rate they had. Press **Save rates**.
2. Switch on **Show earnings in this phone's app** if the partner should see their earnings in their PayTrace app. It appears as an
   **Earnings** card on the app's Home tab (today, this month, the last 7 days, their rates, what is still to receive). Phones with the
   switch off look exactly as before. The phone needs the app version that has the card.
3. **Commission tab:** see each partner's earned, paid and still-owed amounts, and the day-by-day rows (day, phone, provider, kind,
   the day's total, the rate that applied, the commission). **Download CSV** for your own records.
4. When you pay a partner (bKash, Nagad, bank or cash), record it under **Payouts you made** (partner, amount, date, a note such as the
   TrxID). A wrong entry is **voided**, never removed.

How it is counted: a day runs 12:00 AM to 11:59 PM Bangladesh time. Only payments counted in your money totals earn commission
(matched, unmatched and tracked-only Cash Out receipts); payments held in **Review** earn it once you approve them. Only Cash Out
and Send Money messages earn commission, not other message types.


## Step 9: Jobs for agents (the "কাজ করুন এখনই" box)

An **agent** is one wallet on a phone: its bKash, its Nagad, its Rocket or its Upay. When an agent's own balance reaches your amount
(10,000 Tk by default), that agent gets a job on the phone: what to do, **how urgent it is** (Urgent by default), and **your Trust Wallet
address with its network (BNB Smart Chain)** to send to.

1. **Jobs tab → The default job.** Switch **Jobs are on**, check the amount (default 10,000 Tk) and **How urgent** (Urgent), and write what the
   agent should do. You can write `{agent}`, `{balance}` and `{provider}`; each agent sees their own name, balance and wallet type there.
2. Paste your **Trust Wallet address** (it starts with `0x` and is 42 characters; PayTrace refuses anything else, so a mistyped address is
   caught before an agent sees it). The **Network** is filled in as *BNB Smart Chain (BEP20)*. The preview shows what the agent will see.
3. **Agents** (further down the same page): one card per agent. Open **This agent's job** to give that one agent its own description,
   urgency, wallet address or network, or a name (for example "Karim") that appears on the phone. Anything left empty uses the default.
   Switch an agent off to give it no job at all.
4. On the phone (Home tab) each agent that has reached your amount gets its own card, most urgent first: **কাজ করুন এখনই**, the agent's name and
   balance, an urgency label (red = Critical, orange = Urgent, calm = Normal), your description in a box, the wallet address with a **Copy**
   button, the **network** with a warning to send only on that network, and **I sent it**. It shows within about a minute while the app is open.
   The Home icon shows how many jobs are waiting.
5. The agent does the work outside the app (PayTrace never moves money), then taps **I sent it** and types the **exact amount sent** and the
   **P2P charge**. PayTrace remembers the wallet's last balance and expects it to have dropped by exactly that. The job hides and a **yellow**
   card says *Waiting for confirmation*. When the **next Cash Out message** for that wallet arrives, PayTrace checks it:
   the balance in that message, minus the cash-out amount and its commission, must equal the old balance minus the amount sent minus the charge.
   - **Match: green, Verified.** Nagad and Rocket print their commission, so the match is exact. bKash does not, so a normal bKash commission
     (0.30% to 0.60% of the cash-out) counts as a match; a typing slip smaller than that can slip through, so compare with your own wallet history
     when it matters.
   - **No match: red.** The agent can **fix the numbers once**. If they still do not add up it goes to you.
   - **Jobs tab → Sent-money checks** lists every send with its result and how far off it was. For the red ones you can **Accept** (after checking your
     own wallet history) or **Reject**.
   The job comes back with the next balance message if the balance is still at or above your amount. Only a Cash Out message **after** the send
   can confirm it, and only one send per wallet can wait at a time.
6. **The phone rings.** When a job appears, the phone plays an alarm sound and vibrates for **20 seconds**, and shows a notification
   (**কাজ করুন এখনই**, the agent, the balance, and URGENT or CRITICAL) even when the PayTrace app is closed. Tapping the notification opens the job.
   If the job is still not done, it rings again every **10 minutes**. The agent can switch the sound off, or test it, under **Settings → Ring
   when a job appears**. The sound follows the phone's **alarm volume** (not the ringtone volume) and rings even when the phone is on silent,
   but not in Do Not Disturb.

**Clean Home screen.** The phone's Home shows the **last 3 days** of sends as small rows (green Verified, yellow Waiting, red Check / With owner / Rejected); ones still
waiting or needing your decision stay until settled. The phone's **Earnings** tab (only for phones where you switched earnings on) shows what is
**due** (earned minus paid), this month's commission from day 1 to the last day, and only the payments of the **last 3 days**.

The balance is the one printed in that wallet's newest payment message. If an agent sends money without any new message arriving, the
balance does not change by itself, which is why Done exists. The phone needs the newest app build. Two agents using the same wallet type on
the same phone share one balance, because the messages do not say which account they belong to. The ring is sent along with the phone's normal 30-second check-in, so it
arrives within about 30 seconds of a new balance message, and only while the phone is on, online and PayTrace is running. Always send a small
test amount to a new wallet address first.

## Step 8: USDT deposits (BEP20 and TRC20), no phone needed

1. Open the dashboard's **Crypto (USDT)** page.
2. Type **Taka for 1 USDT** (your rate, for example 125). Websites send amounts in taka; PayTrace turns them into USDT at this rate. Open orders keep the rate they were made with.
3. Switch on **BNB Smart Chain (BEP20)** and/or **TRON (TRC20)** and paste your **receiving address** for each (BEP20 starts with `0x`, TRC20 with `T`). Use an address
   of a wallet you control (for example Trust Wallet). **Only the public address goes here. Never type a seed phrase or a private key into PayTrace or send one to anyone.**
4. Press **Save settings**. A website then asks for `provider: "usdt_bep20"` or `"usdt_trc20"` (see the Websites guide).
5. The customer's page shows the exact USDT amount (for example 10.0137) and your address. PayTrace looks at the blockchain **once a minute** and marks the order
   paid when exactly that amount arrives (BEP20 after about 45 seconds of confirmations, TRC20 once TRON confirms it). The website is told through the usual webhook.
6. **If a customer sends the wrong amount, or too late:** the transfer is not matched automatically. It waits on the Crypto page, where you can **Pay order** (pick the order) after checking, or **Ignore** it.
7. Optional free keys, only if the free public servers become slow: `TRONGRID_API_KEY` (free account at trongrid.io) and `BSC_RPC_URL` (your own node address). Set them in Supabase,
   Edge Functions, Secrets, in the private prompt. Without them PayTrace uses the free public servers.
8. Test with a small real transfer first (the smallest deposit is 500 taka). Check that the order turns paid, the transaction hash shows on the Crypto page, and your website received the webhook.

PayTrace only reads the blockchain. It never holds keys or moves your USDT. Customers pay the network fee themselves.


On the Websites page each site can also choose how its USDT payment page looks (six looks, section 2b). Classic is the original; Automatic gives each site its own fixed look.

## Step 9: App updates inside the app

After this is set up, every new build is published automatically, and each phone shows **"Update available"** at the top of the app. The partner taps **Update now**,
then **Install** on Android's own screen. Android always asks for that last tap; a normal app cannot install silently.

**One-time setup in Cloudflare and GitHub (about 10 minutes):**
1. Cloudflare, **R2 Object Storage**, **Create bucket**, name it `paytrace-app`.
2. Open the bucket, **Settings**, **Custom Domains**, **Add** `app.xn--bnq875cj52amsb.click` (this is `app.` plus the web form of your domain). Wait until it says Active.
3. R2, **Manage API tokens**, **Create API token**, permission **Object Read & Write**, limited to the bucket `paytrace-app`. Copy the Access Key ID and the Secret Access Key (shown once) and your **Account ID**.
4. GitHub, the repo's **Settings**, **Secrets and variables**, **Actions**, add four secrets with exactly these names: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (value `paytrace-app`).
   Never paste these values into a chat.

**How it works:** each build that uses your permanent key and runs from `main` uploads `paytrace-<number>.apk` and a small `latest.json` to the bucket (the app file first, the small file last).
Builds without the permanent key, or without these four secrets, are never published. The words partners see under "Update available" come from the first lines of `android/release-notes.txt`; edit that file before a build.

**On each phone, once:** the first time, Android asks to allow PayTrace to install apps ("Install unknown apps"). Tap Allow, go back, tap **Update now** again.
The first phones need the new app installed by hand once (this build); after that they update themselves. Phones check for a new version when the app is open and about every 6 hours in the background, and show one quiet notification the first time.

**Check it works:** the build's summary page in GitHub says "Download bucket: published version 1.0.N". Open `https://app.xn--bnq875cj52amsb.click/latest.json` in a browser; you should see the version number.
The Phones page then shows which phones are behind, using the **Newest phone app** number (type the new build number there after each build; automatic filling comes later).

## Step 10: Nagad balance check from the dashboard (test version)

The dashboard can ask a phone to read its Nagad balance by itself. The phone opens the Nagad menu (`*167#`), types the PIN and reads the balance. **It never sends money.** Nothing is run until you press the button.
This is the first test version: it has not been tried on a real phone yet, so try it on **one** phone first, with the screen on.

**On the phone (once), in the PayTrace app, Settings, "Nagad balance check from the dashboard":**
1. **Accessibility:** tap "Open Accessibility settings", find "PayTrace balance check" and switch it on. On OnePlus, Redmi and other new phones the name may be **grey** and refuse to switch on (Android blocks this for apps installed outside the Play Store). Fix, once per phone: tap the grey name once and press OK; then in the PayTrace card tap **Open PayTrace's app page**, tap the **three dots at the top right**, choose **Allow restricted settings** and confirm (PIN or fingerprint); go back to Accessibility and switch it on. The three-dots entry only appears after you have tapped the grey name once.
2. **Phone calls:** tap Allow (the app needs it to open `*167#`).
3. **SIM:** choose which SIM has Nagad (SIM 1 or SIM 2).
4. **PIN:** type the Nagad PIN on the phone and tap Save PIN. It stays encrypted on that phone only. It is never sent to the dashboard, and never type it anywhere else.
5. **Switch:** turn on "Let the dashboard check the balance".
6. Press **Check Nagad balance now** on the phone first. Keep the screen on and watch. You should see the menu open and close, then "Last check ... Nagad balance Tk ...".

**On the dashboard:** open Phones, find that phone and press **Check Nagad balance**. The phone picks it up within about 30 seconds and the answer appears next to the button.

If it stops, the message says why (for example "The Nagad menu looked different from what PayTrace expects, so it stopped. Nothing was sent."). Send me that message.
The PIN will not be retried after a wrong PIN, so a mistake cannot lock the wallet by repetition. Change the PIN after testing, because it was visible in your recordings.

**Update (2026-11-01): the check now goes straight to the phone network.** PayTrace sends one code (`*167*6*1*<PIN>#`) through Android's own USSD request and reads the answer. Nothing opens on the screen, so the dialer, the Call button and the SIM pop-up are no longer needed, and **Accessibility is only a backup** (switch it on only if the check does not work without it on a phone). What the phone needs: step "Allow phone and SIM access", the SIM choice, the PIN and the switch. Two checks in a row must be about a minute apart (the network keeps a menu open after an answer). bKash and Rocket will follow once their menu steps are known.

**If Accessibility is needed on an OnePlus/Redmi (grey switch) and the three-dots menu does not show "Allow restricted settings":** it can be unlocked from a computer, once per phone. Install Tailscale on the phone and on the computer, sign in with the same account on both, turn on Developer options, Wireless debugging, tap "Pair device with pairing code", then on the computer (use the phone's Tailscale address, not the Wi-Fi one):
`adb pair <tailscale-ip>:<pairing-port>`, then `adb connect <tailscale-ip>:<port>`, then
`adb -s <tailscale-ip>:<port> shell appops set com.paytrace.app ACCESS_RESTRICTED_SETTINGS allow`.
Turn Wireless debugging off afterwards and keep 2-step verification on the Tailscale account (it can reach every phone you add).

**bKash (agent menu) works the same way, but one menu at a time.** In the card choose **bKash** at the top, then do the same steps for it (its own SIM choice and its own PIN). PayTrace asks bKash for `*247#`, answers `4` then `1`, gives the PIN once, and reads "Current balance". On the dashboard each phone now has **Check Nagad balance** and **Check bKash balance**. bKash does not accept the whole check as one code; if this phone's network does not let PayTrace answer the menus directly, it falls back to the dialer way (which needs Accessibility, see above).

### Setting up a phone for the balance check (2026-11-01, tested on the owner's Redmi)

Android switches PayTrace off in Accessibility settings **every time the app is updated**, because the app is installed
from a file and not from a store. On a phone that needs the dialer way, the balance check then stops working until
someone notices. One command per phone, **once ever**, lets PayTrace put itself back. Do this on every phone.

**1. On the phone, first install the newest PayTrace** (Settings, Check for updates). The command below only works on
build 92 or newer, because older builds do not ask for that permission at all.

**2. On the phone, switch on:**
- **Developer options:** Settings, About phone, tap the version seven times.
- **Wireless debugging:** Settings, Developer options, Wireless debugging (also fine over Wi-Fi at home, but for a phone
  somewhere else it needs **Tailscale** on the phone and on the computer, signed in with the same account).
- **Xiaomi, Redmi and POCO only:** also **"USB debugging (Security settings)"** — "Allow granting permissions and
  simulating input via USB debugging", a few rows below the ordinary USB debugging. It needs a Mi account and the
  phone's **mobile data** on (Wi-Fi is not enough). Without it the command below is refused, whatever else you try.
  After switching it on, turn Wireless debugging off and on again, or the computer keeps the old, refused session.

**3. On the computer** (the port is on the phone's Wireless debugging screen and changes every time; the address is the
phone's Tailscale address for a phone somewhere else, or its Wi-Fi address at home):

```
adb pair <address>:<pairing port>          # only the first time, type the 6-digit code from the phone
adb connect <address>:<port>
adb -s <address>:<port> shell pm grant com.paytrace.app android.permission.WRITE_SECURE_SETTINGS
adb -s <address>:<port> shell dumpsys package com.paytrace.app | grep -i write_secure
```

The last line must say `granted=true`. (A second line saying `granted=false, userId=10` is the phone's separate second
space and does not matter.) If it says `granted=false`, the Xiaomi switch above is not really on, or the phone needs to
be restarted and Wireless debugging switched on again.

**4. Switch Accessibility on by hand this one time** (Settings, Accessibility, Downloaded apps, PayTrace balance check).
If the name is grey, run `adb -s <address>:<port> shell appops set com.paytrace.app ACCESS_RESTRICTED_SETTINGS allow`
first. From the next app update on, PayTrace switches it back on by itself and no computer is needed again.

**5. Turn Wireless debugging off** on the phone when you are done.

What that permission is used for: PayTrace adds **its own** balance-check service back to the Accessibility list, and
writes no other setting. Without the permission nothing happens and the switch is flipped by hand as before.

### Reading the balance straight from the phone (2026-11-02)

What the owner's Redmi proved: Nagad **does** answer the direct request with the balance ("Balance: Tk ...", then
"0. Main Menu"), but because that answer offers a next step the network keeps the menu open, and **Android passes an app
only the answers that close it**. PayTrace is told "failure code -1" and never sees the words. That is an Android rule, it
cannot be changed, and it is why the direct way failed on every phone and every try while the same code dialled by hand
worked.

The words are in the phone's own radio log all the same. A phone given one more permission, the same way as the other one,
reads them itself. Then no menu has to be opened, no screen has to be awake and Accessibility is not needed at all:

```
adb -s <address>:<port> shell pm grant com.paytrace.app android.permission.READ_LOGS
```

Only the balance is taken out of those lines. Nothing else is kept, written into the step log or sent anywhere, because the
dialled code — PIN included — is on them too. Without the permission nothing changes and the dialer way is used as before.

**Not known yet:** whether every phone writes the answer where PayTrace can read it. The Redmi (MediaTek) does. The Vivo and
the OnePlus have another kind of chip and may not, and Android 13 may ask the person once before an app may read the log. If
a phone does not, it moves itself to the dialer way as before. Try the check once per phone and look at "Show what happened":
"balance read from the phone log" means it worked.

**Change the wallet PINs after testing.** The dialled code, with the PIN in it, is written into the phone's log by the phone
itself, and the recordings made during the tests show it too.
