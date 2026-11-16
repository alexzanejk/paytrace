import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEPOSIT_PLACEHOLDER, PAGE_BRANDS, apiNotes, depositJson, pageHtml, previewHtml, serverNode, serverPhp,
} from "../dashboard/src/lib/payTemplates.ts";

const GW = "https://example.supabase.co/functions/v1/gateway";

test("there are exactly three pages: bKash, Nagad, Rocket", () => {
  assert.deepEqual(PAGE_BRANDS.map((b) => b.id), ["bkash", "nagad", "rocket"]);
});

for (const b of PAGE_BRANDS) {
  test(`${b.name}: one placeholder, its own loader, never a key or the gateway`, () => {
    const html = pageHtml(b.id);
    assert.equal(html.split(DEPOSIT_PLACEHOLDER).length - 1, 1, "exactly once, so a server's first-match replace fills the script");
    assert.match(html, /var DEPOSIT = __DEPOSIT_JSON__;/);
    assert.match(html, /function showLoading\(/);
    assert.match(html, /function hideLoading\(/);
    assert.ok(html.includes(b.colour));
    assert.ok(html.includes(b.ussd));
    // The page talks only to the website's own server.
    assert.ok(!html.includes("functions/v1"));
    assert.ok(!/authorization/i.test(html));
    assert.ok(!html.includes("innerHTML"));
    assert.ok(html.startsWith("<!doctype html>"));
  });
}

test("each wallet has a different loading animation", () => {
  const loaders = PAGE_BRANDS.map((b) => (pageHtml(b.id).match(/class="(ld-[a-z]+)"/) ?? [])[1]);
  assert.deepEqual(loaders, ["ld-spin", "ld-dots", "ld-bars"]);
});

test("order data cannot break out of the script", () => {
  const j = depositJson({
    orderId: "</script><script>alert(1)</script>", amount: 1, walletNumber: "01712345678", method: "cash_out",
    expiresAt: "2026-11-17T00:00:00Z", submitUrl: "/s", statusUrl: "/t",
  });
  assert.ok(!j.includes("<"));
  assert.equal(JSON.parse(j).orderId, "</script><script>alert(1)</script>");
});

test("the preview is filled, in demo mode, and calls no server", () => {
  const html = previewHtml("nagad", "send_money");
  assert.ok(!html.includes("var DEPOSIT = " + DEPOSIT_PLACEHOLDER));
  const m = html.match(/var DEPOSIT = (\{.*?\});/);
  assert.ok(m);
  const d = JSON.parse(m![1]);
  assert.equal(d.demo, true);
  assert.equal(d.method, "send_money");
  assert.equal(d.submitUrl, "");
});

test("the server samples use the key from the environment, the new call and the escaped JSON", () => {
  for (const code of [serverNode(GW), serverPhp(GW)]) {
    assert.ok(code.includes(GW));
    assert.ok(code.includes("submit-trx"));
    assert.ok(code.includes("create-deposit"));
    assert.ok(code.includes("order-status"));
    assert.ok(code.includes("DEPOSIT_API_KEY"));
    assert.ok(code.includes(DEPOSIT_PLACEHOLDER));
  }
  assert.ok(serverNode(GW).includes('.replace(/</g, "\\\\u003c")'));
  assert.ok(serverPhp(GW).includes("JSON_HEX_TAG"));
});

test("the API notes name every state the page understands", () => {
  const notes = apiNotes(GW);
  for (const s of ["paid", "checking", "review", "used", "expired", "too_many", "wrong_method", "invalid", "closed"]) assert.ok(notes.includes(s), s);
  for (const s of ["used", "too_many", "wrong_method", "invalid", "closed"]) assert.ok(pageHtml("bkash").includes(s + ":"), s);
});
