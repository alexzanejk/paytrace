// Code samples shown in the integration guide. Plain strings; nothing here runs.
import { SUPABASE_URL } from "@/lib/config";

export const GATEWAY = `${SUPABASE_URL}/functions/v1/gateway`;

export type Lang = "curl" | "node" | "php" | "python";
export const LANG_LABEL: Record<Lang, string> = { curl: "curl", node: "Node.js", php: "PHP", python: "Python" };

export const CREATE: Record<Lang, string> = {
  curl: `curl -X POST ${GATEWAY}/create-deposit \\
  -H "Authorization: Bearer $PAYTRACE_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 500,
    "order_id": "SHOP-1001",
    "provider": "nagad",
    "method": "cash_out",
    "return_url": "https://yourshop.com/deposit/thanks"
  }'`,
  node: `// Node 18+ (built-in fetch). Run this on your SERVER, never in the browser.
const res = await fetch("${GATEWAY}/create-deposit", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.PAYTRACE_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    amount: 500,
    order_id: "SHOP-1001",          // your own order number
    provider: "nagad",              // the method the customer chose on YOUR page
    method: "cash_out",             // optional: "send_money" or "cash_out"
    return_url: "https://yourshop.com/deposit/thanks",
  }),
});
const data = await res.json();
if (!res.ok) throw new Error(data.message || data.error);
// Send the customer to data.pay_url
console.log(data.pay_url);`,
  php: `<?php
// Run this on your SERVER, never in the browser.
$ch = curl_init("${GATEWAY}/create-deposit");
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_TIMEOUT => 15,
  CURLOPT_HTTPHEADER => [
    "Authorization: Bearer " . getenv("PAYTRACE_KEY"),
    "Content-Type: application/json",
  ],
  CURLOPT_POSTFIELDS => json_encode([
    "amount" => 500,
    "order_id" => "SHOP-1001",
    "provider" => "nagad",
    "method" => "cash_out",
    "return_url" => "https://yourshop.com/deposit/thanks",
  ]),
]);
$data = json_decode(curl_exec($ch), true);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
if ($status !== 200) { throw new Exception($data["message"] ?? $data["error"] ?? "PayTrace error"); }
header("Location: " . $data["pay_url"]);`,
  python: `# pip install requests. Run this on your SERVER, never in the browser.
import os, requests

r = requests.post(
    "${GATEWAY}/create-deposit",
    headers={"Authorization": f"Bearer {os.environ['PAYTRACE_KEY']}"},
    json={
        "amount": 500,
        "order_id": "SHOP-1001",
        "provider": "nagad",
        "method": "cash_out",
        "return_url": "https://yourshop.com/deposit/thanks",
    },
    timeout=15,
)
data = r.json()
if r.status_code != 200:
    raise RuntimeError(data.get("message") or data.get("error"))
pay_url = data["pay_url"]  # send the customer here`,
};

export const VERIFY: Record<Exclude<Lang, "curl">, string> = {
  node: `import crypto from "node:crypto";

// rawBody must be the EXACT text PayTrace sent (do not parse and re-stringify it).
export function verifyPayTrace(rawBody, signatureHeader, secret) {
  const parts = Object.fromEntries(signatureHeader.split(",").map((p) => p.split("=")));
  const t = parts.t, v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false; // older than 5 minutes
  const expected = crypto.createHmac("sha256", secret).update(\`\${t}.\${rawBody}\`).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Express example
app.post("/paytrace-webhook", express.raw({ type: "application/json" }), (req, res) => {
  const raw = req.body.toString("utf8");
  if (!verifyPayTrace(raw, req.get("x-paytrace-signature") || "", process.env.PAYTRACE_WEBHOOK_SECRET)) {
    return res.status(400).end();
  }
  const { event, data } = JSON.parse(raw);
  if (event === "deposit.paid") {
    // Look up data.order_id in YOUR database. Check data.amount matches. Credit the user once.
  }
  res.status(200).end(); // any 2xx means "received"
});`,
  php: `<?php
$raw = file_get_contents("php://input");           // the EXACT text PayTrace sent
$header = $_SERVER["HTTP_X_PAYTRACE_SIGNATURE"] ?? "";
parse_str(str_replace(",", "&", $header), $p);      // t=...&v1=...
$t = $p["t"] ?? ""; $v1 = $p["v1"] ?? "";
$expected = hash_hmac("sha256", $t . "." . $raw, getenv("PAYTRACE_WEBHOOK_SECRET"));
if (!$t || abs(time() - (int)$t) > 300 || !hash_equals($expected, $v1)) {
  http_response_code(400); exit;
}
$msg = json_decode($raw, true);
if ($msg["event"] === "deposit.paid") {
  // Look up $msg["data"]["order_id"] in YOUR database. Check the amount. Credit the user once.
}
http_response_code(200);                            // any 2xx means "received"`,
  python: `import hashlib, hmac, json, os, time
from flask import Flask, request, abort

app = Flask(__name__)

def verify(raw: bytes, header: str, secret: str) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    t, v1 = parts.get("t"), parts.get("v1")
    if not t or not v1 or abs(time.time() - int(t)) > 300:
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, v1)

@app.post("/paytrace-webhook")
def webhook():
    raw = request.get_data()  # the EXACT bytes PayTrace sent
    if not verify(raw, request.headers.get("X-PayTrace-Signature", ""), os.environ["PAYTRACE_WEBHOOK_SECRET"]):
        abort(400)
    msg = json.loads(raw)
    if msg["event"] == "deposit.paid":
        pass  # look up msg["data"]["order_id"] in YOUR database, check the amount, credit once
    return "", 200  # any 2xx means "received"`,
};

export const STATUS: Record<Lang, string> = {
  curl: `curl -X POST ${GATEWAY}/order-status \\
  -H "Authorization: Bearer $PAYTRACE_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "order_id": "SHOP-1001" }'`,
  node: `const res = await fetch("${GATEWAY}/order-status", {
  method: "POST",
  headers: { Authorization: \`Bearer \${process.env.PAYTRACE_KEY}\`, "Content-Type": "application/json" },
  body: JSON.stringify({ order_id: "SHOP-1001" }),   // or { tracking_number: "..." }
});
const order = await res.json();   // { status: "pending" | "paid" | "review" | "expired" | "cancelled", ... }`,
  php: `<?php
$ch = curl_init("${GATEWAY}/order-status");
curl_setopt_array($ch, [
  CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15,
  CURLOPT_HTTPHEADER => ["Authorization: Bearer " . getenv("PAYTRACE_KEY"), "Content-Type: application/json"],
  CURLOPT_POSTFIELDS => json_encode(["order_id" => "SHOP-1001"]),
]);
$order = json_decode(curl_exec($ch), true);   // $order["status"]`,
  python: `import os, requests
order = requests.post(
    "${GATEWAY}/order-status",
    headers={"Authorization": f"Bearer {os.environ['PAYTRACE_KEY']}"},
    json={"order_id": "SHOP-1001"},   # or {"tracking_number": "..."}
    timeout=15,
).json()   # order["status"]`,
};

export const WEBHOOK_BODY = `{
  "event": "deposit.paid",
  "data": {
    "tracking_number": "c3b20370-3538-4e29-922f-c60a2d17595c",
    "order_id": "SHOP-1001",
    "status": "paid",
    "amount": 500,
    "currency": "BDT",
    "provider": "nagad",
    "trx_id": "726NPKXU",
    "paid_at": "2026-10-23T09:15:41.220Z"
  }
}`;

export const CREATE_RESPONSE = `{
  "tracking_number": "c3b20370-3538-4e29-922f-c60a2d17595c",
  "pay_url": "https://YOUR-PAYTRACE-ADDRESS/pay/?trackingNumber=c3b20370-...",
  "status": "pending",
  "expires_at": "2026-10-23T09:30:00.000Z"
}`;
