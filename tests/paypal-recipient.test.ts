import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidPayoutRecipientEmail } from "../src/lib/paypal";

test("PayPal payout recipient validation rejects placeholders and malformed emails", () => {
  for (const email of ["", "not-an-email", "parent@paraguas.test", "repairs@fixitfast.test", "name@example.com", "name@sub.example.com", "name@localhost", "name@demo.invalid"]) {
    assert.equal(isValidPayoutRecipientEmail(email), false, email);
  }
  for (const email of ["repairs@shop.com", "parent@gmail.com", "billing@repair.co.uk"]) {
    assert.equal(isValidPayoutRecipientEmail(email), true, email);
  }
  assert.equal(isValidPayoutRecipientEmail(null), false);
  assert.equal(isValidPayoutRecipientEmail("a".repeat(250) + "@shop.com"), false);
});
