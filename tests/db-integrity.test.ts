import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paraguas-integrity-"));
process.env.DATA_DIR = dataDir;

// Start from the previous rules schema to exercise the real upgrade path.
const legacy = new Database(path.join(dataDir, "paraguas.db"));
legacy.exec(`
  CREATE TABLE rules (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    jar_percent INTEGER NOT NULL,
    deductible_cents INTEGER NOT NULL,
    max_payout_cents INTEGER NOT NULL,
    covered TEXT NOT NULL,
    excluded TEXT NOT NULL,
    repair_shop_email TEXT NOT NULL
  );
`);
legacy.close();

const dbModule = await import("../src/lib/db");
const db = dbModule.getDb();

after(() => {
  if (db.open) db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("upgrades an existing rules table and seeds the new setting", () => {
  const columns = db.pragma("table_info(rules)") as { name: string }[];
  assert.ok(columns.some((column) => column.name === "streak_bonus_percent"));
  assert.equal(dbModule.getRules().streak_bonus_percent, 10);
});

test("credits a recurring allowance payment once, even when PayPal retries", () => {
  const subscriptionId = "TEST-SUBSCRIPTION-001";
  dbModule.saveSubscription(subscriptionId, "tobi", 2000);
  const before = dbModule.balances("tobi");

  const first = dbModule.recordSubscriptionPayment({
    eventId: "TEST-EVENT-001",
    eventType: "PAYMENT.SALE.COMPLETED",
    subscriptionId,
    saleId: "TEST-SALE-001",
    amountCents: 2000,
  });
  assert.equal(first.credited, true);

  const afterFirst = dbModule.balances("tobi");
  assert.equal(afterFirst.spend + afterFirst.jar - before.spend - before.jar, 2000);

  const retry = dbModule.recordSubscriptionPayment({
    eventId: "TEST-EVENT-001",
    eventType: "PAYMENT.SALE.COMPLETED",
    subscriptionId,
    saleId: "TEST-SALE-001",
    amountCents: 2000,
  });
  assert.equal(retry.duplicate, true);
  assert.deepEqual(dbModule.balances("tobi"), afterFirst);
});

test("rejects a recurring payment whose amount differs from the registered allowance", () => {
  const subscriptionId = "TEST-SUBSCRIPTION-002";
  dbModule.saveSubscription(subscriptionId, "zara", 1500);
  const before = dbModule.balances("zara");

  assert.throws(() => dbModule.recordSubscriptionPayment({
    eventId: "TEST-EVENT-002",
    eventType: "PAYMENT.SALE.COMPLETED",
    subscriptionId,
    saleId: "TEST-SALE-002",
    amountCents: 1501,
  }), /amount does not match/);
  assert.deepEqual(dbModule.balances("zara"), before);
});

test("enforces an atomic account rate limit and returns a retry delay", () => {
  const key = "test:login:parent";
  assert.equal(dbModule.consumeRateLimit(key, 2, 60_000).allowed, true);
  assert.equal(dbModule.consumeRateLimit(key, 2, 60_000).allowed, true);
  const blocked = dbModule.consumeRateLimit(key, 2, 60_000);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.ok(blocked.retryAfterSeconds > 0);
});
