import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readSelfConfig } from "../dashboard/src/pay/selfConfig.ts";
import {
  PAY_CONFIG_PLACEHOLDER, PREVIEW_WALLETS, apiNotes, configJson, previewUrl, serverNode, serverPhp,
} from "../dashboard/src/lib/payTemplates.ts";

const GW = "https://example.supabase.co/functions/v1/gateway";

test("the page reads the website's config, and only a whole one", () => {
  assert.deepEqual(readSelfConfig('{"order_id":"ORD-1","view_url":"/v","submit_url":"/s"}'), { orderId: "ORD-1", viewUrl: "/v", submitUrl: "/s" });
  assert.deepEqual(readSelfConfig('{"order_id":1001,"view_url":"/v","submit_url":"/s"}')?.orderId, "1001");
  assert.equal(readSelfConfig(PAY_CONFIG_PLACEHOLDER), null, "not filled in = PayTrace's own page / the preview");
  assert.equal(readSelfConfig(""), null);
  assert.equal(readSelfConfig(null), null);
  assert.equal(readSelfConfig('{"order_id":"ORD-1","view_url":"/v"}'), null);
  assert.equal(readSelfConfig('{"order_id":"","view_url":"/v","submit_url":"/s"}'), null);
  assert.equal(readSelfConfig("{not json"), null);
  assert.equal(readSelfConfig(JSON.stringify({ order_id: "x".repeat(101), view_url: "/v", submit_url: "/s" })), null);
});

test("the config the server writes cannot break out of the script tag", () => {
  const j = configJson({ order_id: "</script><script>alert(1)</script>", view_url: "/v", submit_url: "/s" });
  assert.ok(!j.includes("<"));
  assert.equal(readSelfConfig(j)?.orderId, "</script><script>alert(1)</script>");
});

test("the page's entry has the placeholder exactly once, inside the config tag", () => {
  const html = readFileSync(new URL("../dashboard/selfpay/index.html", import.meta.url), "utf8");
  assert.equal(html.split(PAY_CONFIG_PLACEHOLDER).length - 1, 1, "a server's first-match replace must hit the config tag");
  assert.match(html, /<script type="application\/json" id="pay-config">__PAY_CONFIG__<\/script>/);
  assert.ok(html.includes('src="/src/pay/main.tsx"'), "it is the real pay page, not a copy");
});

test("the preview shows the real page in demo mode for each wallet", () => {
  assert.deepEqual(PREVIEW_WALLETS.map((w) => w.id), ["bkash", "nagad", "rocket"]);
  assert.equal(previewUrl("nagad", "send_money"), "/selfpay/pay-page.html?demo=1&provider=nagad&method=send_money");
});

test("the server samples keep the key on the server and use the three calls", () => {
  for (const code of [serverNode(GW), serverPhp(GW)]) {
    assert.ok(code.includes(GW));
    for (const route of ["create-deposit", "order-view", "submit-trx"]) assert.ok(code.includes(route), route);
    assert.ok(code.includes("DEPOSIT_API_KEY"));
    assert.ok(code.includes(PAY_CONFIG_PLACEHOLDER));
    assert.ok(code.includes("pay-page.html"));
  }
  assert.ok(serverNode(GW).includes('.replace(/</g, "\\\\u003c")'));
  assert.ok(serverPhp(GW).includes("JSON_HEX_TAG"));
});

test("the API notes name the calls and every state the page understands", () => {
  const notes = apiNotes(GW);
  for (const s of ["order-view", "submit-trx", "create-deposit", "paid", "checking", "review", "used", "expired", "too_many", "wrong_method", "invalid", "closed"]) {
    assert.ok(notes.includes(s), s);
  }
});
