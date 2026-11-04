import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = process.env.DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

export type Member = {
  id: string;
  name: string;
  role: "parent" | "teen";
  age: number | null;
  allowance_cents: number;
  payout_email: string | null;
  emoji: string;
};

export type Rules = {
  jar_percent: number;
  deductible_cents: number;
  max_payout_cents: number;
  streak_bonus_percent: number;
  covered: string[];
  excluded: string[];
  repair_shop_email: string;
};

export type LedgerEntry = {
  id: number;
  member_id: string;
  bucket: "spend" | "jar";
  amount_cents: number;
  kind: string;
  memo: string;
  paypal_ref: string | null;
  created_at: string;
};

export type ClaimStatus = "pending_parent" | "payout_pending" | "payout_failed" | "paid" | "denied";

export type Claim = {
  id: number;
  member_id: string;
  title: string;
  description: string;
  amount_cents: number;
  photo_file: string | null;
  photo_mime: string | null;
  status: ClaimStatus;
  ai: string | null;
  payout_cents: number | null;
  payee_email: string | null;
  paypal_ref: string | null;
  parent_note: string | null;
  created_at: string;
  decided_at: string | null;
};

let db: Database.Database | null = null;

export function getDb() {
  if (db) return db;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  db = new Database(path.join(DATA_DIR, "paraguas.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, age INTEGER,
      allowance_cents INTEGER NOT NULL DEFAULT 0, payout_email TEXT, emoji TEXT NOT NULL DEFAULT '🙂'
    );
    CREATE TABLE IF NOT EXISTS rules (
      id INTEGER PRIMARY KEY CHECK (id = 1), jar_percent INTEGER NOT NULL, deductible_cents INTEGER NOT NULL,
      max_payout_cents INTEGER NOT NULL, streak_bonus_percent INTEGER NOT NULL, covered TEXT NOT NULL,
      excluded TEXT NOT NULL, repair_shop_email TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, member_id TEXT NOT NULL, bucket TEXT NOT NULL,
      amount_cents INTEGER NOT NULL, kind TEXT NOT NULL, memo TEXT NOT NULL, paypal_ref TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT, member_id TEXT NOT NULL, title TEXT NOT NULL,
      description TEXT NOT NULL, amount_cents INTEGER NOT NULL, photo_file TEXT, photo_mime TEXT,
      status TEXT NOT NULL, ai TEXT, payout_cents INTEGER, payee_email TEXT, paypal_ref TEXT,
      parent_note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), decided_at TEXT
    );
    CREATE TABLE IF NOT EXISTS payments (
      order_id TEXT PRIMARY KEY, member_id TEXT NOT NULL, amount_cents INTEGER NOT NULL,
      method TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
      subscription_id TEXT PRIMARY KEY, member_id TEXT NOT NULL, amount_cents INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'APPROVAL_PENDING', created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS login_rate_limits (
      rate_key TEXT PRIMARY KEY, window_started_at INTEGER NOT NULL, attempts INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS paypal_webhook_events (
      event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, processed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS streak_bonus_awards (
      member_id TEXT NOT NULL, streak_end_week TEXT NOT NULL, order_id TEXT NOT NULL UNIQUE,
      amount_cents INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (member_id, streak_end_week)
    );
  `);
  // Upgrade databases created before the optional saving-streak match setting existed.
  const ruleColumns = db.pragma("table_info(rules)") as { name: string }[];
  if (!ruleColumns.some((column) => column.name === "streak_bonus_percent")) {
    db.exec("ALTER TABLE rules ADD COLUMN streak_bonus_percent INTEGER NOT NULL DEFAULT 10");
  }
  const count = db.prepare("SELECT COUNT(*) AS n FROM members").get() as { n: number };
  if (count.n === 0) seed(db);
  return db;
}

function seed(d: Database.Database) {
  const m = d.prepare(
    "INSERT INTO members (id, name, role, age, allowance_cents, payout_email, emoji) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  m.run("parent", "Ada", "parent", null, 0, process.env.DEMO_PARENT_EMAIL || "parent@paraguas.test", "👩🏾");
  m.run("tobi", "Tobi", "teen", 15, 2000, null, "🧑🏾‍🎤");
  m.run("zara", "Zara", "teen", 13, 1500, null, "👧🏾");
  d.prepare(
    `INSERT INTO rules (id, jar_percent, deductible_cents, max_payout_cents, streak_bonus_percent, covered, excluded, repair_shop_email)
     VALUES (1, 20, 500, 15000, 10, ?, ?, ?)`,
  ).run(
    JSON.stringify([
      "Accidental damage to a phone, tablet, laptop or headphones",
      "Accidental damage to a bike or school calculator",
      "Theft, if reported to a parent the same day",
    ]),
    JSON.stringify([
      "Damage done on purpose",
      "Items that were simply lost",
      "Cosmetic scratches that don't affect use",
      "Items lent to a friend when they broke",
    ]),
    process.env.DEMO_REPAIR_SHOP_EMAIL || "repairs@fixitfast.test",
  );
  const l = d.prepare(
    "INSERT INTO ledger (member_id, bucket, amount_cents, kind, memo, paypal_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))",
  );
  for (const [id, cents] of [["tobi", 2000], ["zara", 1500]] as const) {
    for (let weeksAgo = 12; weeksAgo >= 1; weeksAgo--) {
      const jar = Math.round((cents * 20) / 100);
      l.run(id, "spend", cents - jar, "allowance", "Weekly allowance", "SEED", `-${weeksAgo * 7} days`);
      l.run(id, "jar", jar, "allowance", "Umbrella fund share", "SEED", `-${weeksAgo * 7} days`);
    }
  }
  l.run("tobi", "spend", -1250, "purchase", "Game top-up", null, "-9 days");
  l.run("zara", "spend", -600, "purchase", "Art supplies", null, "-5 days");
  l.run("tobi", "jar", 2500, "bonus", "Parent kick-start for the umbrella fund", null, "-84 days");
  l.run("zara", "jar", 2500, "bonus", "Parent kick-start for the umbrella fund", null, "-84 days");
  l.run("tobi", "jar", 800, "bonus", "Parent bonus: 4-week saving streak", null, "-2 days");
}

export function getRules(): Rules {
  const r = getDb().prepare("SELECT * FROM rules WHERE id = 1").get() as Record<string, unknown>;
  return {
    jar_percent: r.jar_percent as number,
    deductible_cents: r.deductible_cents as number,
    max_payout_cents: r.max_payout_cents as number,
    streak_bonus_percent: r.streak_bonus_percent as number,
    covered: JSON.parse(r.covered as string),
    excluded: JSON.parse(r.excluded as string),
    repair_shop_email: r.repair_shop_email as string,
  };
}

export function updateRules(patch: Partial<Rules>) {
  const next = { ...getRules(), ...patch };
  getDb()
    .prepare(
      `UPDATE rules SET jar_percent = ?, deductible_cents = ?, max_payout_cents = ?, streak_bonus_percent = ?,
       covered = ?, excluded = ?, repair_shop_email = ? WHERE id = 1`,
    )
    .run(
      next.jar_percent,
      next.deductible_cents,
      next.max_payout_cents,
      next.streak_bonus_percent,
      JSON.stringify(next.covered),
      JSON.stringify(next.excluded),
      next.repair_shop_email,
    );
  return next;
}

export function getMembers(): Member[] {
  return getDb().prepare("SELECT * FROM members ORDER BY role, name").all() as Member[];
}

export function getMember(id: string): Member | undefined {
  return getDb().prepare("SELECT * FROM members WHERE id = ?").get(id) as Member | undefined;
}

export function getTeens(): Member[] {
  return getMembers().filter((m) => m.role === "teen");
}

export function balances(memberId: string) {
  const rows = getDb()
    .prepare("SELECT bucket, COALESCE(SUM(amount_cents), 0) AS total FROM ledger WHERE member_id = ? GROUP BY bucket")
    .all(memberId) as { bucket: string; total: number }[];
  const out = { spend: 0, jar: 0 };
  for (const r of rows) out[r.bucket as "spend" | "jar"] = r.total;
  return out;
}

export function addLedger(e: Omit<LedgerEntry, "id" | "created_at">) {
  getDb()
    .prepare("INSERT INTO ledger (member_id, bucket, amount_cents, kind, memo, paypal_ref) VALUES (?, ?, ?, ?, ?, ?)")
    .run(e.member_id, e.bucket, e.amount_cents, e.kind, e.memo, e.paypal_ref);
}

export function getLedger(memberId?: string, limit = 50): LedgerEntry[] {
  const d = getDb();
  return (memberId
    ? d.prepare("SELECT * FROM ledger WHERE member_id = ? ORDER BY created_at DESC, id DESC LIMIT ?").all(memberId, limit)
    : d.prepare("SELECT * FROM ledger ORDER BY created_at DESC, id DESC LIMIT ?").all(limit)) as LedgerEntry[];
}

export function getClaims(memberId?: string): Claim[] {
  const d = getDb();
  return (memberId
    ? d.prepare("SELECT * FROM claims WHERE member_id = ? ORDER BY id DESC").all(memberId)
    : d.prepare("SELECT * FROM claims ORDER BY id DESC").all()) as Claim[];
}

export function getClaim(id: number): Claim | undefined {
  return getDb().prepare("SELECT * FROM claims WHERE id = ?").get(id) as Claim | undefined;
}

/** Atomically allow a bounded number of actions for one account within a rolling window. */
export function consumeRateLimit(rateKey: string, limit: number, windowMs: number) {
  if (!rateKey || !Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1) {
    throw new Error("Invalid rate-limit configuration");
  }
  const d = getDb();
  const now = Date.now();
  return d.transaction(() => {
    const current = d.prepare("SELECT window_started_at, attempts FROM login_rate_limits WHERE rate_key = ?")
      .get(rateKey) as { window_started_at: number; attempts: number } | undefined;
    if (!current || now - current.window_started_at >= windowMs || now < current.window_started_at) {
      d.prepare("INSERT INTO login_rate_limits (rate_key, window_started_at, attempts) VALUES (?, ?, 1) ON CONFLICT(rate_key) DO UPDATE SET window_started_at = excluded.window_started_at, attempts = 1")
        .run(rateKey, now);
      return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
    }
    if (current.attempts >= limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((current.window_started_at + windowMs - now) / 1000)),
      };
    }
    const next = current.attempts + 1;
    d.prepare("UPDATE login_rate_limits SET attempts = ? WHERE rate_key = ?").run(next, rateKey);
    return { allowed: true, remaining: Math.max(0, limit - next), retryAfterSeconds: 0 };
  })();
}

/** Save the PayPal subscription-to-member mapping before the payer is redirected. */
export function saveSubscription(subscriptionId: string, memberId: string, amountCents: number) {
  getDb().prepare(
    "INSERT INTO subscriptions (subscription_id, member_id, amount_cents, status) VALUES (?, ?, ?, 'APPROVAL_PENDING')",
  ).run(subscriptionId, memberId, amountCents);
}

export function updateSubscriptionStatus(subscriptionId: string, status: string) {
  getDb().prepare("UPDATE subscriptions SET status = ? WHERE subscription_id = ?").run(status, subscriptionId);
}

/** Idempotently credit one completed recurring PayPal charge and split it using the current jar rule. */
export function recordSubscriptionPayment(input: {
  eventId: string;
  eventType: string;
  subscriptionId: string;
  saleId: string;
  amountCents: number;
}) {
  const d = getDb();
  const apply = d.transaction(() => {
    const sub = d.prepare("SELECT member_id, amount_cents FROM subscriptions WHERE subscription_id = ?")
      .get(input.subscriptionId) as { member_id: string; amount_cents: number } | undefined;
    if (!sub) throw new Error("PayPal subscription is not linked to a Paraguas family member");
    if (input.amountCents !== sub.amount_cents) throw new Error("PayPal subscription payment amount does not match the allowance");
    const event = d.prepare("INSERT OR IGNORE INTO paypal_webhook_events (event_id, event_type) VALUES (?, ?)")
      .run(input.eventId, input.eventType);
    if (!event.changes) return { credited: false, duplicate: true };
    const payment = d.prepare(
      "INSERT OR IGNORE INTO payments (order_id, member_id, amount_cents, method, status) VALUES (?, ?, ?, 'subscription', 'COMPLETED')",
    ).run(input.saleId, sub.member_id, input.amountCents);
    if (!payment.changes) return { credited: false, duplicate: true };
    creditAllowance(sub.member_id, input.amountCents, input.saleId, "Weekly allowance (PayPal subscription)");
    return { credited: true, duplicate: false };
  });
  return apply();
}

/** Simulate the first recurring payment only for the local MOCK subscription flow. */
export function recordMockSubscriptionPayment(subscriptionId: string) {
  const sub = getDb().prepare("SELECT amount_cents FROM subscriptions WHERE subscription_id = ?")
    .get(subscriptionId) as { amount_cents: number } | undefined;
  if (!sub) throw new Error("Mock subscription is not registered");
  return recordSubscriptionPayment({
    eventId: `mock-event-${subscriptionId}`,
    eventType: "PAYMENT.SALE.COMPLETED",
    subscriptionId,
    saleId: `mock-sale-${subscriptionId}`,
    amountCents: sub.amount_cents,
  });
}

export type StreakStatus = { weeks: number; bonusCents: number; eligible: boolean; alreadyMatched: boolean; endWeek: string | null };

/** Four consecutive weekly allowance deposits qualify for a parent-funded jar match. */
export function getStreakStatus(memberId: string): StreakStatus {
  const d = getDb();
  const rows = d.prepare(`
    SELECT date(created_at, 'weekday 0', '-6 days') AS week_start, SUM(amount_cents) AS contributed
    FROM ledger
    WHERE member_id = ? AND bucket = 'jar' AND kind = 'allowance' AND amount_cents > 0
    GROUP BY week_start ORDER BY week_start DESC LIMIT 52
  `).all(memberId) as { week_start: string; contributed: number }[];
  if (!rows.length) return { weeks: 0, bonusCents: 0, eligible: false, alreadyMatched: false, endWeek: null };
  const latest = new Date(rows[0].week_start + 'T00:00:00Z');
  const now = new Date();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  if ((monday.getTime() - latest.getTime()) / 86400000 > 7) return { weeks: 0, bonusCents: 0, eligible: false, alreadyMatched: false, endWeek: rows[0].week_start };
  let weeks = 1;
  for (let i = 1; i < rows.length; i++) {
    const previous = new Date(rows[i - 1].week_start + 'T00:00:00Z');
    const next = new Date(rows[i].week_start + 'T00:00:00Z');
    if ((previous.getTime() - next.getTime()) / 86400000 !== 7) break;
    weeks++;
  }
  const endWeek = rows[0].week_start;
  const alreadyMatched = Boolean(d.prepare("SELECT 1 FROM streak_bonus_awards WHERE member_id = ? AND streak_end_week = ? AND status IN (?, ?)").get(memberId, endWeek, "PENDING", "COMPLETED"));
  const eligible = weeks >= 4 && !alreadyMatched;
  const contributed = rows.slice(0, 4).reduce((sum, row) => sum + row.contributed, 0);
  const bonusCents = eligible ? Math.round((contributed * getRules().streak_bonus_percent) / 100) : 0;
  return { weeks, bonusCents, eligible, alreadyMatched, endWeek };
}

/** Reserve one unique match for a specific four-week streak before creating its PayPal order. */
export function reserveStreakBonus(memberId: string, endWeek: string, orderId: string, amountCents: number) {
  getDb().prepare("INSERT INTO streak_bonus_awards (member_id, streak_end_week, order_id, amount_cents, status) VALUES (?, ?, ?, ?, ?) ON CONFLICT(member_id, streak_end_week) DO UPDATE SET order_id = excluded.order_id, amount_cents = excluded.amount_cents, status = excluded.status WHERE streak_bonus_awards.status = ?").run(memberId, endWeek, orderId, amountCents, "PENDING", "CANCELLED");
}
/** Credit an allowance top-up, splitting it between spending money and the umbrella fund. */
export function creditAllowance(memberId: string, cents: number, ref: string, label: string) {
  const { jar_percent } = getRules();
  const jar = Math.round((cents * jar_percent) / 100);
  addLedger({ member_id: memberId, bucket: "spend", amount_cents: cents - jar, kind: "allowance", memo: label, paypal_ref: ref });
  addLedger({ member_id: memberId, bucket: "jar", amount_cents: jar, kind: "allowance", memo: `Umbrella fund share (${jar_percent}%)`, paypal_ref: ref });
  return { spend: cents - jar, jar };
}

export function familySnapshot() {
  const teens = getTeens().map((t) => ({ ...t, balances: balances(t.id) }));
  return { teens, rules: getRules() };
}

/** Release a streak reservation only when the PayPal order is still uncompleted. */
export function cancelStreakBonus(orderId: string) {
  const d = getDb();
  return d.transaction(() => {
    const changed = d.prepare("UPDATE payments SET status = ? WHERE order_id = ? AND method = ? AND status = ?").run("CANCELLED", orderId, "streak_bonus", "CREATED");
    if (changed.changes) d.prepare("UPDATE streak_bonus_awards SET status = ? WHERE order_id = ? AND status = ?").run("CANCELLED", orderId, "PENDING");
    return changed.changes > 0;
  })();
}
