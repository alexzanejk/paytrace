/** Self-hosted pay page (owner 2026-11-17: "our original customer pay page, same UI and design, as source code"): the
 *  website hosts PayTrace's own pay page as one file (built from the real page into /selfpay/pay-page.html, see
 *  vite.selfpay.config.ts), and its server fills in the order and answers the page's two questions with the website's key.
 *  This file holds the server code and API notes the dashboard shows next to it. Pure strings, tested in
 *  tests/selfPay.test.ts.
 *
 *  Rules the samples keep: the key stays on the website's server; the page gets ONE JSON value in place of the
 *  placeholder, with "<" escaped; the customer is credited only from the webhook or order-status "paid". */

/** Where the dashboard serves the one-file page (built on every deploy, so it is always the current pay page). */
export const SELF_PAGE_PATH = "/selfpay/pay-page.html";

/** The placeholder the website's server replaces with the order's JSON. It appears exactly once in the file. */
export const PAY_CONFIG_PLACEHOLDER = "__PAY_CONFIG__";

/** The wallets the page is shown for in the dashboard's preview (the page takes its wallet from the order itself). */
export const PREVIEW_WALLETS = [
  { id: "bkash", name: "bKash" },
  { id: "nagad", name: "Nagad" },
  { id: "rocket", name: "Rocket" },
] as const;

export type PreviewWallet = (typeof PREVIEW_WALLETS)[number]["id"];

/** The preview address: the real page in its demo mode, which talks to no server. */
export function previewUrl(wallet: PreviewWallet, method: "cash_out" | "send_money"): string {
  return `${SELF_PAGE_PATH}?demo=1&provider=${wallet}&method=${method}`;
}

export interface PageConfig {
  order_id: string;
  view_url: string;
  submit_url: string;
}

/** What the website's server writes in place of the placeholder: JSON with "<" escaped so "</script>" can never appear. */
export function configJson(c: PageConfig): string {
  return JSON.stringify(c).replace(/</g, "\\u003c");
}

/** The website's server in Node.js (Express): open the page for an order, and answer its two questions. */
export function serverNode(gatewayUrl: string): string {
  return `// npm install express        (Node 18 or newer)
// Save the page from the dashboard as pay-page.html next to this file.
// Your API key from the dashboard (Websites page) goes in the environment, never in the page.
const express = require("express");
const fs = require("fs");
const app = express();
app.use(express.json());

const GATEWAY = "${gatewayUrl}";
const KEY = process.env.DEPOSIT_API_KEY;
const PAGE = fs.readFileSync(__dirname + "/pay-page.html", "utf8");

async function gateway(route, body) {
  const r = await fetch(GATEWAY + "/" + route, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + KEY },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

// 1. The customer chose bKash, Nagad or Rocket and an amount on your site: make the order and show the page.
app.get("/deposit/:provider", async (req, res) => {
  const orderId = "ORD-" + Date.now();                       // your own order number
  const { status, data } = await gateway("create-deposit", {
    order_id: orderId, amount: Number(req.query.amount), provider: req.params.provider, method: "cash_out",
  });
  if (status !== 200) return res.status(502).send("Could not start the deposit: " + (data.error || status));
  const config = { order_id: orderId, view_url: "/deposit/view", submit_url: "/deposit/submit" };
  const json = JSON.stringify(config).replace(/</g, "\\\\u003c");
  res.type("html").send(PAGE.replace("${PAY_CONFIG_PLACEHOLDER}", json));
});

// 2. The page asks what to show (every 4 seconds while it is open). Pass the answer back unchanged.
app.post("/deposit/view", async (req, res) => {
  // Check here that req.body.order_id belongs to the signed-in customer.
  const { status, data } = await gateway("order-view", { order_id: req.body.order_id });
  res.status(status).json(data);
});

// 3. The customer pressed Confirm: pass the TrxID on. Pass the answer back unchanged.
app.post("/deposit/submit", async (req, res) => {
  // Check here that req.body.order_id belongs to the signed-in customer.
  const { status, data } = await gateway("submit-trx", { order_id: req.body.order_id, transaction_id: req.body.transaction_id });
  res.status(status).json(data);
});

// 4. Credit the customer ONLY from the signed result message (webhook deposit.paid) or order-status "paid",
//    never because the page said so.
app.listen(3000);
`;
}

/** The same three routes in PHP: deposit.php?step=page|view|submit. */
export function serverPhp(gatewayUrl: string): string {
  return `<?php
// Save the page from the dashboard as pay-page.html next to this file.
// Your API key from the dashboard (Websites page) goes in the environment, never in the page.
const GATEWAY = '${gatewayUrl}';

function gateway($route, $body) {
  $ch = curl_init(GATEWAY . '/' . $route);
  curl_setopt_array($ch, [
    CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15,
    CURLOPT_HTTPHEADER => ['content-type: application/json', 'authorization: Bearer ' . getenv('DEPOSIT_API_KEY')],
    CURLOPT_POSTFIELDS => json_encode($body),
  ]);
  $out = curl_exec($ch);
  $status = curl_getinfo($ch, CURLINFO_HTTP_CODE) ?: 502;
  curl_close($ch);
  return [$status, $out ?: '{}'];
}

$step = $_GET['step'] ?? 'page';

if ($step === 'page') {
  // 1. Make the order and show the page.   deposit.php?provider=bkash&amount=1000
  $orderId = 'ORD-' . time();
  [$status, $out] = gateway('create-deposit', [
    'order_id' => $orderId, 'amount' => (float)($_GET['amount'] ?? 0), 'provider' => $_GET['provider'] ?? '', 'method' => 'cash_out',
  ]);
  if ($status !== 200) { http_response_code(502); exit('Could not start the deposit.'); }
  $config = ['order_id' => $orderId, 'view_url' => 'deposit.php?step=view', 'submit_url' => 'deposit.php?step=submit'];
  header('content-type: text/html; charset=utf-8');
  echo str_replace('${PAY_CONFIG_PLACEHOLDER}', json_encode($config, JSON_HEX_TAG | JSON_UNESCAPED_SLASHES),
                   file_get_contents(__DIR__ . '/pay-page.html'));
  exit;
}

// 2 and 3. The page's two questions. Check here that order_id belongs to the signed-in customer.
$in = json_decode(file_get_contents('php://input'), true) ?: [];
if ($step === 'view') {
  [$status, $out] = gateway('order-view', ['order_id' => $in['order_id'] ?? '']);
} elseif ($step === 'submit') {
  [$status, $out] = gateway('submit-trx', ['order_id' => $in['order_id'] ?? '', 'transaction_id' => $in['transaction_id'] ?? '']);
} else {
  http_response_code(404); exit;
}
http_response_code($status);
header('content-type: application/json');
echo $out;
// Credit the customer ONLY from the webhook deposit.paid or order-status "paid", never because the page said so.
`;
}

/** The gateway calls a self-hosted page needs, in plain words, for the website's developer. */
export function apiNotes(gatewayUrl: string): string {
  return `The page is PayTrace's own deposit page in one file. It looks and works exactly the same; it only talks to YOUR
server instead of ours. Your server makes three calls, always with  Authorization: Bearer <your key>.

1) Create the order (as before)
POST ${gatewayUrl}/create-deposit
{ "order_id": "ORD-1001", "amount": 1000, "provider": "bkash", "method": "cash_out" }
-> { "tracking_number", "status", "expires_at", "amount", "provider", "wallet_number", "wallet_method", "pay_url" }
Then send the page with  ${PAY_CONFIG_PLACEHOLDER}  replaced by
{"order_id":"ORD-1001","view_url":"/deposit/view","submit_url":"/deposit/submit"}   (write "<" as \\u003c)

2) What the page shows — the page posts {"order_id"} to your view_url every 4 seconds; you call
POST ${gatewayUrl}/order-view
{ "order_id": "ORD-1001" }        (or "tracking_number")
-> the page's data (status, amount, wallet number, time left, ...). Return it to the page unchanged, with the same
   HTTP status (404 = no such order). Not counted against your 120 calls a minute.

3) The customer pressed Confirm — the page posts {"order_id","transaction_id"} to your submit_url; you call
POST ${gatewayUrl}/submit-trx
{ "order_id": "ORD-1001", "transaction_id": "DKH8KOLCEM" }
-> { "state": "paid" | "checking" | "review" | "used" | "expired" | "too_many" | "wrong_method" | "invalid" | "closed", ... }
Return it to the page unchanged, with the same HTTP status. At most 5 tries per order.

Credit the customer only on status "paid" (the signed webhook deposit.paid, or order-status), never because the page
said so. order-status answers and webhooks also carry wallet_number and wallet_method.
`;
}
