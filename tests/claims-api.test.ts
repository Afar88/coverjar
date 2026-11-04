import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("claim API enforces roles, upload validation, submission limits and payout decisions", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paraguas-claims-api-"));
  process.env.DATA_DIR = dataDir;
  delete process.env.PAYPAL_CLIENT_ID;
  delete process.env.PAYPAL_CLIENT_SECRET;
  process.env.NODE_ENV = "test";

  const { getDb, getClaim, balances } = await import("../src/lib/db");
  const { createSession, sessionCookie } = await import("../src/lib/auth");
  const { POST: submitClaim } = await import("../src/app/api/claims/route");
  const { POST: decideClaim } = await import("../src/app/api/claims/[id]/decide/route");
  const db = getDb();
  const teenCookie = sessionCookie(createSession("teen", "tobi")).split(";")[0];
  const parentCookie = sessionCookie(createSession("parent", "parent")).split(";")[0];

  const submit = (cookie?: string, photo?: File) => {
    const form = new FormData();
    form.set("title", "Cracked phone screen");
    form.set("description", "The screen cracked after it fell.");
    form.set("amount", "50.00");
    if (photo) form.set("photo", photo);
    return submitClaim(new Request("http://localhost/api/claims", {
      method: "POST",
      headers: cookie ? { cookie } : undefined,
      body: form,
    }));
  };

  const insertClaim = (title: string) => Number(db.prepare(
    "INSERT INTO claims (member_id, title, description, amount_cents, status) VALUES (?, ?, ?, ?, 'pending_parent')",
  ).run("tobi", title, "Test claim", 5000).lastInsertRowid);

  try {
    await t.test("blocks anonymous and parent users from submitting teen claims", async () => {
      assert.equal((await submit()).status, 403);
      assert.equal((await submit(parentCookie)).status, 403);
    });

    await t.test("requires a photo and rejects a spoofed image file", async () => {
      assert.equal((await submit(teenCookie)).status, 400);
      const fakePng = new File(["<svg><script>alert(1)</script></svg>"], "damage.png", { type: "image/png" });
      const response = await submit(teenCookie, fakePng);
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /valid JPEG, PNG or WebP/);
    });

    await t.test("limits repeated AI claim submissions for one teen account", async () => {
      for (let i = 0; i < 3; i++) assert.equal((await submit(teenCookie)).status, 400);
      const blocked = await submit(teenCookie);
      assert.equal(blocked.status, 429);
      assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    });

    await t.test("rejects parent decisions from teen sessions and prevents over-claim payouts", async () => {
      const id = insertClaim("Payout cap test");
      const body = JSON.stringify({ decision: "approve", amount: "50.01" });
      const teenResponse = await decideClaim(new Request("http://localhost/api/claims/" + id + "/decide", {
        method: "POST", headers: { cookie: teenCookie, "content-type": "application/json" }, body,
      }), { params: Promise.resolve({ id: String(id) }) });
      assert.equal(teenResponse.status, 403);

      const parentResponse = await decideClaim(new Request("http://localhost/api/claims/" + id + "/decide", {
        method: "POST", headers: { cookie: parentCookie, "content-type": "application/json" }, body,
      }), { params: Promise.resolve({ id: String(id) }) });
      assert.equal(parentResponse.status, 400);
      assert.equal(getClaim(id)?.status, "pending_parent");
    });

    await t.test("settles a simulated approved payout once and denies repeat decisions", async () => {
      const id = insertClaim("Approved repair");
      const before = balances("tobi").jar;
      const response = await decideClaim(new Request("http://localhost/api/claims/" + id + "/decide", {
        method: "POST",
        headers: { cookie: parentCookie, "content-type": "application/json" },
        body: JSON.stringify({ decision: "approve", amount: "10.00", payee: "parent" }),
      }), { params: Promise.resolve({ id: String(id) }) });
      assert.equal(response.status, 200);
      assert.equal(getClaim(id)?.status, "paid");
      assert.equal(before - balances("tobi").jar, 1000);

      const repeated = await decideClaim(new Request("http://localhost/api/claims/" + id + "/decide", {
        method: "POST",
        headers: { cookie: parentCookie, "content-type": "application/json" },
        body: JSON.stringify({ decision: "deny" }),
      }), { params: Promise.resolve({ id: String(id) }) });
      assert.equal(repeated.status, 409);
      assert.equal(getClaim(id)?.status, "paid");
    });

    await t.test("records a parent's denial and makes the decision immutable", async () => {
      const id = insertClaim("Denied repair");
      const response = await decideClaim(new Request("http://localhost/api/claims/" + id + "/decide", {
        method: "POST",
        headers: { cookie: parentCookie, "content-type": "application/json" },
        body: JSON.stringify({ decision: "deny", note: "Not covered by our family rules" }),
      }), { params: Promise.resolve({ id: String(id) }) });
      assert.equal(response.status, 200);
      assert.equal(getClaim(id)?.status, "denied");
      assert.equal(getClaim(id)?.parent_note, "Not covered by our family rules");
    });
  } finally {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
