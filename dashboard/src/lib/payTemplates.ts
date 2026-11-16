/** Self-hosted pay pages (owner 2026-11-17): the bKash, Nagad and Rocket TrxID-submission pages as single, standalone
 *  HTML files a website copies onto its OWN server, plus the server code that fills them and passes the customer's TrxID
 *  to the gateway. Pure strings, no I/O, tested in tests/payTemplates.test.ts.
 *
 *  Safety rules the files keep (and the tests check):
 *  - the page never holds the website's API key: it talks only to the website's own server (submitUrl / statusUrl);
 *  - order data arrives as ONE JSON value the server writes in place of __DEPOSIT_JSON__, with "<" escaped, so a value
 *    can never break out of the script;
 *  - everything shown is set with textContent, never innerHTML;
 *  - every page carries its own loading animation, with showLoading(text) / hideLoading(). */

export type PageProvider = "bkash" | "nagad" | "rocket";

export interface PageBrand {
  id: PageProvider;
  name: string;
  colour: string;
  ussd: string;
  app: string;
  /** What the loading animation looks like, in a few words (shown on the dashboard). */
  loader: string;
}

export const PAGE_BRANDS: readonly PageBrand[] = [
  { id: "bkash", name: "bKash", colour: "#e2136e", ussd: "*247#", app: "bKash", loader: "a pink ring that spins" },
  { id: "nagad", name: "Nagad", colour: "#f24f41", ussd: "*167#", app: "Nagad", loader: "three orange dots that bounce" },
  { id: "rocket", name: "Rocket", colour: "#8a278f", ussd: "*322#", app: "Rocket", loader: "purple bars that rise and fall" },
] as const;

export const brandOf = (id: PageProvider): PageBrand => PAGE_BRANDS.find((b) => b.id === id)!;

/** The placeholder the website's server replaces with the order as JSON. */
export const DEPOSIT_PLACEHOLDER = "__DEPOSIT_JSON__";

export interface DepositData {
  orderId: string;
  amount: number;
  walletNumber: string;
  method: "cash_out" | "send_money";
  expiresAt: string;
  submitUrl: string;
  statusUrl: string;
  successUrl?: string;
  failedUrl?: string;
  demo?: boolean;
}

/** What the server writes in place of the placeholder: JSON with "<" escaped so "</script>" can never appear. */
export function depositJson(d: DepositData): string {
  return JSON.stringify(d).replace(/</g, "\\u003c");
}

/** A page filled with made-up numbers, for the dashboard's preview (it never calls any server). */
export function previewHtml(id: PageProvider, method: "cash_out" | "send_money" = "cash_out"): string {
  const demo: DepositData = {
    orderId: "DEMO-1001", amount: 1000, walletNumber: id === "rocket" ? "016123456789" : "01712345678", method,
    expiresAt: new Date(Date.now() + 40 * 60_000).toISOString(), submitUrl: "", statusUrl: "", demo: true,
  };
  return pageHtml(id).replace(DEPOSIT_PLACEHOLDER, depositJson(demo));
}

const LOADERS: Record<PageProvider, { css: string; markup: string }> = {
  bkash: {
    css: `.ld-spin{width:54px;height:54px;border-radius:50%;border:5px solid rgba(226,19,110,.18);border-top-color:#e2136e;animation:ld-rot .8s linear infinite}
@keyframes ld-rot{to{transform:rotate(360deg)}}`,
    markup: `<div class="ld-spin" aria-hidden="true"></div>`,
  },
  nagad: {
    css: `.ld-dots{display:flex;gap:9px}.ld-dots i{width:13px;height:13px;border-radius:50%;background:#f24f41;animation:ld-bounce 1s infinite ease-in-out}
.ld-dots i:nth-child(2){animation-delay:.15s}.ld-dots i:nth-child(3){animation-delay:.3s}
@keyframes ld-bounce{0%,80%,100%{transform:translateY(0);opacity:.45}40%{transform:translateY(-14px);opacity:1}}`,
    markup: `<div class="ld-dots" aria-hidden="true"><i></i><i></i><i></i></div>`,
  },
  rocket: {
    css: `.ld-bars{display:flex;gap:6px;align-items:flex-end;height:42px}.ld-bars i{width:8px;height:12px;border-radius:3px;background:#8a278f;animation:ld-bar 1s infinite ease-in-out}
.ld-bars i:nth-child(2){animation-delay:.12s}.ld-bars i:nth-child(3){animation-delay:.24s}.ld-bars i:nth-child(4){animation-delay:.36s}
@keyframes ld-bar{0%,100%{height:12px;opacity:.5}50%{height:42px;opacity:1}}`,
    markup: `<div class="ld-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></div>`,
  },
};

/** The whole page for one wallet, ready to copy. The website's server replaces __DEPOSIT_JSON__ for each order. */
export function pageHtml(id: PageProvider): string {
  const b = brandOf(id);
  const ld = LOADERS[id];
  return `<!doctype html>
<html lang="bn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Payment</title>
<!--
  ${b.name} deposit page. Copy this file onto YOUR website and serve it for each order.
  Your SERVER replaces the word __DEPOSIT_JSON (two underscores at each end) in the script below with the order as JSON, for example:
    {"orderId":"ORD-1001","amount":1000,"walletNumber":"01712345678","method":"cash_out",
     "expiresAt":"2026-11-17T10:40:00Z","submitUrl":"/deposit/submit","statusUrl":"/deposit/status",
     "successUrl":"https://your-site/deposit/done","failedUrl":"https://your-site/deposit/failed"}
  Take amount, walletNumber, method and expiresAt from the gateway's create-deposit answer
  (amount, wallet_number, wallet_method, expires_at). Escape "<" as \\u003c when you write it.
  The page sends the customer's TrxID to YOUR server (submitUrl), never to the gateway: your API key stays on your server.
-->
<style>
*{box-sizing:border-box}html,body{margin:0;background:#fff;color:#111;font-family:Roboto,"Noto Sans Bengali",system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-text-size-adjust:100%}
.page{max-width:460px;margin:0 auto;min-height:100vh;display:flex;flex-direction:column}
.top{background:#006644;color:#fff;height:74px;display:flex;align-items:center;gap:12px;padding:0 16px}
.top .amt{font-size:20px;font-weight:900;line-height:30px;white-space:nowrap}
.top .hint{font-size:14px;font-weight:700;line-height:20px;flex:1}
.lang{border:0;border-radius:3px;font-size:11px;padding:3px 6px;background:#fff;color:#006644;cursor:pointer}
.body{padding:24px 20px;display:flex;flex-direction:column;gap:14px}
.banner{background:${b.colour};color:#fff;border-radius:10px;height:76px;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:900;letter-spacing:.5px}
.way{text-align:center;font-weight:700;color:${b.colour}}
.box{background:rgba(0,0,0,.05);border-radius:8px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:56px}
.box small{display:block;color:#666;font-size:12px}.box b{font-size:20px;letter-spacing:.5px}
.copy{border:1px solid ${b.colour};color:${b.colour};background:#fff;border-radius:6px;padding:7px 12px;font-weight:700;cursor:pointer}
.field{position:relative}
.field input{width:100%;height:56px;border:2px solid #e00;border-radius:6px;padding:20px 12px 6px;font-size:18px;text-transform:uppercase;outline:none}
.field input:focus{border-color:${b.colour}}
.field label{position:absolute;left:12px;top:6px;font-size:12px;color:#666}
.go{height:48px;border:0;border-radius:10px;background:${b.colour};color:#fff;font-size:17px;font-weight:700;cursor:pointer}
.go:disabled{opacity:.5}
.warn{color:#f44336;font-size:12px;line-height:17px;margin:0}
.steps{margin:0;padding-left:18px;font-size:13px;line-height:20px;color:#444}
.timer{text-align:center;font-size:13px;color:#666}
.msg{display:none;border-radius:8px;padding:12px 14px;font-size:14px;line-height:20px}
.msg.bad{display:block;background:#fdecea;color:#b71c1c}.msg.ok{display:block;background:#e8f5e9;color:#1b5e20}
.result{display:none;flex-direction:column;align-items:center;text-align:center;gap:10px;padding:48px 24px}
.result .big{font-size:22px;font-weight:800}.result.ok .big{color:#1b8a3a}.result.bad .big{color:#c62828}.result.wait .big{color:${b.colour}}
.result p{margin:0;color:#444;line-height:22px}
.overlay{position:fixed;inset:0;background:rgba(255,255,255,.88);display:none;flex-direction:column;align-items:center;justify-content:center;gap:18px;z-index:10}
.overlay.on{display:flex}.overlay p{margin:0;font-weight:600;color:#333;text-align:center;padding:0 24px}
${ld.css}
@media (prefers-reduced-motion:reduce){*{animation-duration:2s!important}}
</style>
</head>
<body>
<div class="page">
  <div class="top">
    <div class="amt" id="amt"></div>
    <div class="hint" id="t-hint"></div>
    <button class="lang" id="lang" type="button">EN</button>
  </div>

  <div class="body" id="form">
    <div class="banner">${b.name}</div>
    <div class="way" id="way"></div>
    <div class="box">
      <div><small id="t-wallet"></small><b id="wallet"></b></div>
      <button class="copy" id="copy" type="button"></button>
    </div>
    <ol class="steps" id="steps"></ol>
    <div class="field">
      <label for="trx" id="t-trx"></label>
      <input id="trx" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="40" inputmode="text">
    </div>
    <div class="msg" id="msg" role="alert"></div>
    <button class="go" id="go" type="button"></button>
    <p class="warn" id="t-warn1"></p>
    <p class="warn" id="t-warn2"></p>
    <div class="timer" id="timer"></div>
  </div>

  <div class="result" id="result" role="status">
    <div class="big" id="r-title"></div>
    <p id="r-text"></p>
  </div>
</div>

<div class="overlay" id="overlay" role="status" aria-live="polite">
  ${ld.markup}
  <p id="ld-text"></p>
</div>

<script>
(function () {
  "use strict";
  var DEPOSIT = ${DEPOSIT_PLACEHOLDER};
  var NAME = "${b.name}", USSD = "${b.ussd}", APP = "${b.app}";

  var T = {
    bn: {
      hint: "নিচের নম্বরে টাকা পাঠিয়ে TrxID দিন", wallet: "ওয়ালেট নম্বর", copy: "কপি", copied: "কপি হয়েছে",
      cash_out: NAME + " ক্যাশ আউট", send_money: NAME + " সেন্ড মানি",
      steps: [USSD + " ডায়াল করুন বা " + APP + " অ্যাপ খুলুন", "{way} বেছে নিন", "উপরের নম্বর ও ৳{amount} দিন", "SMS থেকে TrxID কপি করে নিচে দিন"],
      trx: "লেনদেন আইডি (TrxID)", go: "নিশ্চিত করুন",
      warn1: "শুধু উপরের নম্বরে, ঠিক ৳{amount} পাঠান।", warn2: "ভুল TrxID দিলে আপনার ডিপোজিট যোগ হবে না।",
      left: "বাকি সময় {t}", sending: "TrxID পাঠানো হচ্ছে…", checking: "আপনার পেমেন্ট যাচাই করা হচ্ছে…",
      paid: "ডিপোজিট সফল", paidText: "৳{amount} আপনার অ্যাকাউন্টে যোগ হয়েছে।",
      review: "যাচাই চলছে", reviewText: "আপনার পেমেন্ট হাতে যাচাই করা হচ্ছে। কিছুক্ষণ পরে আবার দেখুন।",
      expired: "সময় শেষ", expiredText: "এই অর্ডারের সময় শেষ হয়ে গেছে। নতুন ডিপোজিট শুরু করুন।",
      empty: "TrxID দিন।", invalid: "এই TrxID সঠিক নয়। আবার দেখে লিখুন।", used: "এই TrxID আগেই ব্যবহার হয়েছে।",
      too_many: "অনেকবার চেষ্টা হয়েছে। সাপোর্টে যোগাযোগ করুন।", wrong_method: "এই TrxID অন্য উপায়ে করা পেমেন্টের।",
      closed: "এই অর্ডার বন্ধ হয়ে গেছে।", net: "সংযোগ হয়নি। আবার চেষ্টা করুন।",
      notyet: "এখনো পেমেন্ট পাওয়া যায়নি। TrxID ঠিক থাকলে কিছুক্ষণ অপেক্ষা করুন।"
    },
    en: {
      hint: "Pay to the number below, then enter the TrxID", wallet: "Wallet number", copy: "Copy", copied: "Copied",
      cash_out: NAME + " Cash Out", send_money: NAME + " Send Money",
      steps: ["Dial " + USSD + " or open the " + APP + " app", "Choose {way}", "Enter the number above and ৳{amount}", "Copy the TrxID from the SMS into the box below"],
      trx: "Transaction ID (TrxID)", go: "Confirm",
      warn1: "Send exactly ৳{amount}, only to the number above.", warn2: "A wrong TrxID means your deposit is not added.",
      left: "Time left {t}", sending: "Sending your TrxID…", checking: "Checking your payment…",
      paid: "Deposit successful", paidText: "৳{amount} has been added to your account.",
      review: "Being checked", reviewText: "Your payment is being checked by hand. Please look again in a little while.",
      expired: "Time is up", expiredText: "This order has expired. Please start a new deposit.",
      empty: "Enter the TrxID.", invalid: "That TrxID is not valid. Please check it.", used: "This TrxID has already been used.",
      too_many: "Too many tries. Please contact support.", wrong_method: "This TrxID is from a different way of paying.",
      closed: "This order is closed.", net: "Could not connect. Please try again.",
      notyet: "Payment not found yet. If the TrxID is right, please wait a little."
    }
  };

  var lang = "bn";
  var $ = function (id) { return document.getElementById(id); };
  var amountText = Number(DEPOSIT.amount).toLocaleString("en-US");
  var fill = function (s) {
    var way = DEPOSIT.method === "send_money" ? T[lang].send_money : T[lang].cash_out;
    return String(s).replace("{amount}", amountText).replace("{way}", way);
  };

  function draw() {
    var t = T[lang];
    $("amt").textContent = "৳ " + amountText;
    $("t-hint").textContent = t.hint;
    $("lang").textContent = lang === "bn" ? "EN" : "বাং";
    $("way").textContent = DEPOSIT.method === "send_money" ? t.send_money : t.cash_out;
    $("t-wallet").textContent = t.wallet;
    $("wallet").textContent = DEPOSIT.walletNumber;
    $("copy").textContent = t.copy;
    var ol = $("steps");
    while (ol.firstChild) ol.removeChild(ol.firstChild);
    t.steps.forEach(function (s) { var li = document.createElement("li"); li.textContent = fill(s); ol.appendChild(li); });
    $("t-trx").textContent = t.trx;
    $("go").textContent = t.go;
    $("t-warn1").textContent = fill(t.warn1);
    $("t-warn2").textContent = t.warn2;
    tick();
  }

  // ---- loading animation ----
  function showLoading(text) { $("ld-text").textContent = text || ""; $("overlay").className = "overlay on"; }
  function hideLoading() { $("overlay").className = "overlay"; }
  window.showLoading = showLoading; window.hideLoading = hideLoading;

  function say(key, ok) { var m = $("msg"); m.textContent = T[lang][key] || key; m.className = "msg " + (ok ? "ok" : "bad"); }
  function clearSay() { $("msg").className = "msg"; }

  function finish(kind) {
    hideLoading(); stopTimer();
    var t = T[lang], r = $("result");
    $("form").style.display = "none";
    r.style.display = "flex";
    r.className = "result " + (kind === "paid" ? "ok" : kind === "review" ? "wait" : "bad");
    $("r-title").textContent = t[kind];
    $("r-text").textContent = fill(t[kind + "Text"]);
    var go = kind === "paid" ? DEPOSIT.successUrl : kind === "expired" ? DEPOSIT.failedUrl : "";
    if (go) setTimeout(function () { window.location.href = go; }, kind === "paid" ? 4000 : 8000);
  }

  // ---- talking to YOUR server ----
  function post(url, body) {
    return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" })
      .then(function (r) { return r.json().catch(function () { return {}; }); });
  }

  var polls = 0, pollTimer = null;
  function poll() {
    if (DEPOSIT.demo) { setTimeout(function () { finish("paid"); }, 1500); return; }
    post(DEPOSIT.statusUrl, { order_id: DEPOSIT.orderId }).then(function (d) {
      var s = d && d.status;
      if (s === "paid") return finish("paid");
      if (s === "expired" || s === "cancelled") return finish("expired");
      if (s === "review") return finish("review");
      polls++;
      if (polls >= 36) { hideLoading(); say("notyet"); $("go").disabled = false; return; } // about 3 minutes
      pollTimer = setTimeout(poll, 5000);
    }).catch(function () { pollTimer = setTimeout(poll, 5000); });
  }

  function submit() {
    clearSay();
    var trx = $("trx").value.replace(/\\s+/g, "").toUpperCase();
    if (!trx) return say("empty");
    if (!/^[A-Z0-9]{6,40}$/.test(trx)) return say("invalid");
    $("go").disabled = true;
    showLoading(T[lang].sending);
    if (DEPOSIT.demo) {
      setTimeout(function () { showLoading(T[lang].checking); poll(); }, 1200);
      return;
    }
    post(DEPOSIT.submitUrl, { order_id: DEPOSIT.orderId, transaction_id: trx }).then(function (d) {
      var s = d && d.state;
      if (s === "paid") return finish("paid");
      if (s === "review") return finish("review");
      if (s === "expired") return finish("expired");
      if (s === "checking") { showLoading(T[lang].checking); polls = 0; return poll(); }
      hideLoading(); $("go").disabled = false;
      say(T[lang][s] ? s : "net");
    }).catch(function () { hideLoading(); $("go").disabled = false; say("net"); });
  }

  // ---- time left ----
  var timer = null;
  function tick() {
    var left = Math.floor((new Date(DEPOSIT.expiresAt).getTime() - Date.now()) / 1000);
    if (!isFinite(left)) { $("timer").textContent = ""; return; }
    if (left <= 0) { $("timer").textContent = ""; return finish("expired"); }
    var m = Math.floor(left / 60), s = left % 60;
    $("timer").textContent = T[lang].left.replace("{t}", m + ":" + (s < 10 ? "0" : "") + s);
  }
  function stopTimer() { if (timer) clearInterval(timer); if (pollTimer) clearTimeout(pollTimer); }

  $("copy").addEventListener("click", function () {
    var done = function () { $("copy").textContent = T[lang].copied; setTimeout(function () { $("copy").textContent = T[lang].copy; }, 1500); };
    if (navigator.clipboard) navigator.clipboard.writeText(DEPOSIT.walletNumber).then(done, done); else done();
  });
  $("lang").addEventListener("click", function () { lang = lang === "bn" ? "en" : "bn"; draw(); });
  $("go").addEventListener("click", submit);
  $("trx").addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });

  draw();
  timer = setInterval(tick, 1000);
})();
</script>
</body>
</html>
`;
}

/** The website's server, in Node.js (Express). Three routes: open the page, take the TrxID, answer the page's status check. */
export function serverNode(gatewayUrl: string): string {
  return `// npm install express
// Your API key from the dashboard (Websites page). Keep it on the server, never in the page.
const express = require("express");
const fs = require("fs");
const app = express();
app.use(express.json());

const GATEWAY = "${gatewayUrl}";
const KEY = process.env.DEPOSIT_API_KEY;
const PAGES = { bkash: fs.readFileSync("bkash.html", "utf8"), nagad: fs.readFileSync("nagad.html", "utf8"), rocket: fs.readFileSync("rocket.html", "utf8") };

async function gateway(route, body) {
  const r = await fetch(GATEWAY + "/" + route, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + KEY },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

// 1. The customer chose a wallet and an amount on your site: create the order and show YOUR page.
app.get("/deposit/:provider", async (req, res) => {
  const provider = req.params.provider;               // "bkash" | "nagad" | "rocket"
  if (!PAGES[provider]) return res.status(404).end();
  const orderId = "ORD-" + Date.now();                // your own order number
  const amount = Number(req.query.amount);            // from your own form
  const { status, data } = await gateway("create-deposit", { order_id: orderId, amount, provider, method: "cash_out" });
  if (status !== 200) return res.status(502).send("Could not start the deposit: " + (data.error || status));
  const deposit = {
    orderId, amount: data.amount, walletNumber: data.wallet_number, method: data.wallet_method,
    expiresAt: data.expires_at, submitUrl: "/deposit/submit", statusUrl: "/deposit/status",
    successUrl: "/wallet", failedUrl: "/deposit",
  };
  const json = JSON.stringify(deposit).replace(/</g, "\\\\u003c");
  res.type("html").send(PAGES[provider].replace("${DEPOSIT_PLACEHOLDER}", json));
});

// 2. The page sends the TrxID the customer typed; pass it to the gateway with your key.
app.post("/deposit/submit", async (req, res) => {
  const { order_id, transaction_id } = req.body || {};
  // Check here that order_id belongs to the signed-in customer.
  const { data } = await gateway("submit-trx", { order_id, transaction_id });
  res.json({ state: data.state || "net" });
});

// 3. The page asks "is it paid yet?" every few seconds.
app.post("/deposit/status", async (req, res) => {
  const { data } = await gateway("order-status", { order_id: req.body.order_id });
  res.json({ status: data.status || "pending" });
});

// 4. Credit the customer ONLY from the signed result message (webhook) or order-status = "paid", never from the page.
app.listen(3000);
`;
}

/** The same three routes in PHP (one file, deposit.php?step=page|submit|status). */
export function serverPhp(gatewayUrl: string): string {
  return `<?php
// Your API key from the dashboard (Websites page). Keep it on the server, never in the page.
const GATEWAY = '${gatewayUrl}';
$KEY = getenv('DEPOSIT_API_KEY');

function gateway($route, $body) {
  global $KEY;
  $ch = curl_init(GATEWAY . '/' . $route);
  curl_setopt_array($ch, [
    CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15,
    CURLOPT_HTTPHEADER => ['content-type: application/json', 'authorization: Bearer ' . $KEY],
    CURLOPT_POSTFIELDS => json_encode($body),
  ]);
  $out = curl_exec($ch);
  $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  return [$status, json_decode($out ?: '{}', true) ?: []];
}

$step = $_GET['step'] ?? 'page';

if ($step === 'page') {
  // 1. Create the order and show YOUR page.  deposit.php?provider=bkash&amount=1000
  $provider = $_GET['provider'] ?? '';
  if (!in_array($provider, ['bkash', 'nagad', 'rocket'], true)) { http_response_code(404); exit; }
  $orderId = 'ORD-' . time();
  [$status, $data] = gateway('create-deposit', ['order_id' => $orderId, 'amount' => (float)($_GET['amount'] ?? 0), 'provider' => $provider, 'method' => 'cash_out']);
  if ($status !== 200) { http_response_code(502); exit('Could not start the deposit: ' . htmlspecialchars($data['error'] ?? (string)$status)); }
  $deposit = [
    'orderId' => $orderId, 'amount' => $data['amount'], 'walletNumber' => $data['wallet_number'], 'method' => $data['wallet_method'],
    'expiresAt' => $data['expires_at'], 'submitUrl' => 'deposit.php?step=submit', 'statusUrl' => 'deposit.php?step=status',
    'successUrl' => '/wallet', 'failedUrl' => '/deposit',
  ];
  $page = file_get_contents(__DIR__ . '/' . $provider . '.html');
  header('content-type: text/html; charset=utf-8');
  echo str_replace('${DEPOSIT_PLACEHOLDER}', json_encode($deposit, JSON_HEX_TAG | JSON_UNESCAPED_UNICODE), $page);
  exit;
}

$in = json_decode(file_get_contents('php://input'), true) ?: [];
header('content-type: application/json');

if ($step === 'submit') {
  // 2. Pass the customer's TrxID to the gateway. Check here that order_id belongs to the signed-in customer.
  [, $data] = gateway('submit-trx', ['order_id' => $in['order_id'] ?? '', 'transaction_id' => $in['transaction_id'] ?? '']);
  echo json_encode(['state' => $data['state'] ?? 'net']);
  exit;
}

if ($step === 'status') {
  // 3. The page asks "is it paid yet?". Credit the customer only from the webhook or a "paid" status, never from the page.
  [, $data] = gateway('order-status', ['order_id' => $in['order_id'] ?? '']);
  echo json_encode(['status' => $data['status'] ?? 'pending']);
  exit;
}
`;
}

/** The new and changed gateway calls, in plain words, for the developer. */
export function apiNotes(gatewayUrl: string): string {
  return `1) Create the order (your server, as before)
POST ${gatewayUrl}/create-deposit
Authorization: Bearer <your key>
{ "order_id": "ORD-1001", "amount": 1000, "provider": "bkash", "method": "cash_out" }
-> { "tracking_number", "status", "expires_at", "amount": 1000, "provider": "bkash",
     "wallet_number": "01712345678", "wallet_method": "cash_out", "pay_url" }
Show wallet_number and amount on your own page (or send the customer to pay_url, as before).

2) Hand over the TrxID the customer typed on your page (your server)
POST ${gatewayUrl}/submit-trx
Authorization: Bearer <your key>
{ "order_id": "ORD-1001", "transaction_id": "DKH8KOLCEM" }     (or "tracking_number" instead of "order_id")
-> { "state": "paid" | "checking" | "review" | "used" | "expired" | "too_many" | "wrong_method" | "invalid" | "closed",
     "order_id", "tracking_number", "transaction_id" }
"checking" = the TrxID is saved and the payment has not arrived yet; ask order-status again in a few seconds.
At most 5 tries per order. Same limit as the other calls: 120 calls a minute per key.

3) Ask how it went (your server, as before)
POST ${gatewayUrl}/order-status
{ "order_id": "ORD-1001" }
-> { "status": "pending" | "paid" | "review" | "expired" | "cancelled", "amount", "provider", "trx_id",
     "wallet_number", "wallet_method", "paid_at", ... }

4) The signed result message (webhook) now also carries wallet_number and wallet_method.
Credit the customer only on status "paid" (webhook deposit.paid or order-status), never because the page said so.
`;
}
