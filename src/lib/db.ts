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

export type ClaimStatus = "pending_parent" | "paid" | "denied";

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
  `);
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
