import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_PASSWORD, passwordProblem, readLanding, saveErrorText } from "../dashboard/src/lib/password.ts";

test("a reset email's landing is noticed", () => {
  assert.deepEqual(readLanding("#access_token=abc.def&expires_in=3600&refresh_token=x&token_type=bearer&type=recovery"), {
    recovery: true,
    error: null,
  });
  assert.equal(readLanding("#access_token=abc&type=signup").recovery, false);
  assert.equal(readLanding("#type=recovery").recovery, false);
  assert.equal(readLanding("#/devices").recovery, false);
  assert.equal(readLanding("").recovery, false);
});

test("an expired link says so", () => {
  const l = readLanding("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
  assert.equal(l.recovery, false);
  assert.match(l.error ?? "", /expired/);
  assert.match(readLanding("#error=server_error").error ?? "", /did not work/);
});

test("password rules", () => {
  assert.match(passwordProblem("short", "short") ?? "", new RegExp(String(MIN_PASSWORD)));
  assert.match(passwordProblem(" long enough pw", " long enough pw") ?? "", /space/);
  assert.match(passwordProblem("aaaaaaaaaaaa", "aaaaaaaaaaaa") ?? "", /repeat/);
  assert.match(passwordProblem("river-lamp-orange", "river-lamp-orang") ?? "", /not the same/);
  assert.equal(passwordProblem("river-lamp-orange", "river-lamp-orange"), null);
});

test("Supabase's refusals in plain words", () => {
  assert.match(saveErrorText("New password should be different from the old password.", "same_password"), /already have/);
  assert.match(saveErrorText("Password is known to be weak", "weak_password"), /too easy/);
  assert.match(saveErrorText("AAL2 required", "insufficient_aal"), /two-step/);
  assert.match(saveErrorText("something odd"), /not saved: something odd/);
});
