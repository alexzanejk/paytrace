import { test } from "node:test";
import assert from "node:assert/strict";
import { hasPersonalBkash, readPersonalBalances } from "../dashboard/src/lib/personalBalance.ts";

test("reads one line per personal account, as the phone writes them", () => {
  const rows = readPersonalBalances([
    "Personal bKash balance\naccount 1 01700000000 SIM 2: Tk 17205.08\naccount 2 01800000000 SIM 1: failed no_pin",
  ]);
  assert.deepEqual(rows, [
    { account: 1, number: "01700000000", sim: 2, balance: 17205.08, error: null },
    { account: 2, number: "01800000000", sim: 1, balance: null, error: "no_pin" },
  ]);
});

test("ignores the heading, the step log and anything else", () => {
  assert.deepEqual(readPersonalBalances(["What the phone saw:\nstart, dialer way, bKash", "random text"]), []);
  assert.deepEqual(readPersonalBalances(null), []);
});

test("knows whether a phone has a personal bKash account", () => {
  assert.equal(hasPersonalBkash([{ provider: "bkash", kind: "agent" }]), false);
  assert.equal(hasPersonalBkash([{ provider: "nagad", kind: "personal" }]), false);
  assert.equal(hasPersonalBkash([{ provider: "bkash", kind: "personal" }]), true);
  assert.equal(hasPersonalBkash(undefined), false);
});
