import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./helpers";

test("Neon PostgreSQL data layer preserves payment idempotency and rate limits",async t=>{
  const {pool}=await createTestDatabase();
  const db=await import("../src/lib/db");
  const {settlePayment}=await import("../src/app/api/topup/settle");
  try {
    await t.test("credits a recurring allowance once, including webhook retries",async()=>{
      await db.saveSubscription("TEST-SUB-001","tobi",2000);
      const before=await db.balances("tobi");
      const first=await db.recordSubscriptionPayment({eventId:"EVENT-1",eventType:"PAYMENT.SALE.COMPLETED",subscriptionId:"TEST-SUB-001",saleId:"SALE-1",amountCents:2000});
      assert.equal(first.credited,true);
      const after=await db.balances("tobi");
      assert.equal(after.spend+after.jar-before.spend-before.jar,2000);
      const retry=await db.recordSubscriptionPayment({eventId:"EVENT-1",eventType:"PAYMENT.SALE.COMPLETED",subscriptionId:"TEST-SUB-001",saleId:"SALE-1",amountCents:2000});
      assert.equal(retry.duplicate,true);
      assert.deepEqual(await db.balances("tobi"),after);
    });
    await t.test("rejects a recurring charge that differs from the configured allowance",async()=>{
      await db.saveSubscription("TEST-SUB-002","zara",1500);
      const before=await db.balances("zara");
      await assert.rejects(()=>db.recordSubscriptionPayment({eventId:"EVENT-2",eventType:"PAYMENT.SALE.COMPLETED",subscriptionId:"TEST-SUB-002",saleId:"SALE-2",amountCents:1501}),/amount does not match/);
      assert.deepEqual(await db.balances("zara"),before);
    });
    await t.test("settles a PayPal capture only for the exact amount and only once",async()=>{
      await db.queryRows("INSERT INTO payments(order_id,member_id,amount_cents,method,status) VALUES('LIVE-ORDER-1','tobi',1200,'paypal','CREATED')");
      const before=await db.balances("tobi");
      const result=await settlePayment("LIVE-ORDER-1","CAPTURE-1",{value:"12.00",currencyCode:"USD"});
      assert.equal(result.alreadySettled,false);
      const after=await db.balances("tobi");
      assert.equal(after.spend+after.jar-before.spend-before.jar,1200);
      const duplicate=await settlePayment("LIVE-ORDER-1","CAPTURE-RETRY",{value:"99.99",currencyCode:"USD"});
      assert.equal(duplicate.alreadySettled,true);
      assert.deepEqual(await db.balances("tobi"),after);
    });
    await t.test("rejects mismatched amounts and currencies without ledger writes",async()=>{
      await db.queryRows("INSERT INTO payments(order_id,member_id,amount_cents,method,status) VALUES('LIVE-ORDER-2','zara',1500,'paypal','CREATED')");
      const before=await db.balances("zara");
      await assert.rejects(()=>settlePayment("LIVE-ORDER-2","CAPTURE-2",{value:"15.01",currencyCode:"USD"}),/amount or currency/);
      await assert.rejects(()=>settlePayment("LIVE-ORDER-2","CAPTURE-2",{value:"15.00",currencyCode:"EUR"}),/amount or currency/);
      assert.deepEqual(await db.balances("zara"),before);
      const [payment]=await db.queryRows<{status:string}>("SELECT status FROM payments WHERE order_id='LIVE-ORDER-2'");
      assert.equal(payment.status,"CREATED");
    });
    await t.test("enforces a bounded account rate limit",async()=>{
      const key="test:login:parent";
      assert.equal((await db.consumeRateLimit(key,2,60000)).allowed,true);
      assert.equal((await db.consumeRateLimit(key,2,60000)).allowed,true);
      const blocked=await db.consumeRateLimit(key,2,60000);
      assert.equal(blocked.allowed,false);
      assert.equal(blocked.remaining,0);
      assert.ok(blocked.retryAfterSeconds>0);
    });
  } finally { await pool.end(); }
});
