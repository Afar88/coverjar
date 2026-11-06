import { Pool } from "@neondatabase/serverless";
import { randomBytes, randomUUID } from "node:crypto";

export type Member = {
  id: string; name: string; role: "parent" | "teen"; family_id?: string; age: number | null;
  allowance_cents: number; payout_email: string | null; emoji: string;
};
export type Rules = {
  jar_percent: number; deductible_cents: number; max_payout_cents: number; streak_bonus_percent: number;
  covered: string[]; excluded: string[]; repair_shop_email: string;
};
export type LedgerEntry = {
  id: number; member_id: string; family_id?:string; bucket: "spend" | "jar"; amount_cents: number;
  kind: string; memo: string; paypal_ref: string | null; created_at: string;
};
export type ClaimStatus = "pending_parent" | "payout_pending" | "payout_failed" | "paid" | "denied";
export type Claim = {
  id: number; member_id: string; family_id?:string; title: string; description: string; amount_cents: number;
  photo_file: string | null; photo_mime: string | null; status: ClaimStatus; ai: string | null;
  payout_cents: number | null; payee_email: string | null; paypal_ref: string | null;
  parent_note: string | null; created_at: string; decided_at: string | null;
};
type QueryResult = { rows: any[]; rowCount: number | null };
type Queryable = { query: (text: string, values?: unknown[]) => Promise<QueryResult> };
type ReleasableClient = Queryable & { release: () => void };
type PoolLike = Queryable & { connect: () => Promise<ReleasableClient> };

let pool: PoolLike | null = null;
let schemaPromise: Promise<void> | null = null;

function getPool() {
  if (pool) return pool;
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be configured with a Neon PostgreSQL connection string");
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 8_000 }) as unknown as PoolLike;
  return pool;
}

async function ensureSchema() {
  if (!schemaPromise) schemaPromise = (async () => {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query(`
        CREATE TABLE IF NOT EXISTS members (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('parent','teen')), age INTEGER,
          allowance_cents INTEGER NOT NULL DEFAULT 0, payout_email TEXT, emoji TEXT NOT NULL DEFAULT '🙂'
        );
        CREATE TABLE IF NOT EXISTS rules (
          id INTEGER PRIMARY KEY CHECK (id = 1), jar_percent INTEGER NOT NULL, deductible_cents INTEGER NOT NULL,
          max_payout_cents INTEGER NOT NULL, streak_bonus_percent INTEGER NOT NULL DEFAULT 10,
          covered JSONB NOT NULL, excluded JSONB NOT NULL, repair_shop_email TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ledger (
          id BIGSERIAL PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id), bucket TEXT NOT NULL CHECK (bucket IN ('spend','jar')),
          amount_cents INTEGER NOT NULL, kind TEXT NOT NULL, memo TEXT NOT NULL, paypal_ref TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS ledger_member_created_idx ON ledger(member_id, created_at DESC, id DESC);
        CREATE TABLE IF NOT EXISTS claims (
          id BIGSERIAL PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id), title TEXT NOT NULL,
          description TEXT NOT NULL, amount_cents INTEGER NOT NULL, photo_file TEXT, photo_mime TEXT,
          status TEXT NOT NULL, ai TEXT, payout_cents INTEGER, payee_email TEXT, paypal_ref TEXT,
          parent_note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), decided_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS claims_member_id_idx ON claims(member_id, id DESC);
        CREATE TABLE IF NOT EXISTS payments (
          order_id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id), amount_cents INTEGER NOT NULL,
          method TEXT NOT NULL, status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS subscriptions (
          subscription_id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id), amount_cents INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'APPROVAL_PENDING', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS login_rate_limits (
          rate_key TEXT PRIMARY KEY, window_started_at BIGINT NOT NULL, attempts INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS paypal_webhook_events (
          event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS streak_bonus_awards (
          member_id TEXT NOT NULL REFERENCES members(id), streak_end_week DATE NOT NULL, order_id TEXT NOT NULL UNIQUE,
          amount_cents INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (member_id, streak_end_week)
        );
        ALTER TABLE rules ADD COLUMN IF NOT EXISTS streak_bonus_percent INTEGER NOT NULL DEFAULT 10;
        ALTER TABLE members ADD COLUMN IF NOT EXISTS pin_hash TEXT;

      -- Multi-family foundation. Existing demo data is preserved in one legacy family.
      CREATE TABLE IF NOT EXISTS families (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        parent_name TEXT NOT NULL,
        password_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      INSERT INTO families(id,code,parent_name,password_hash)
        VALUES ('legacy-family','LEGACY-0000','Ada',NULL)
        ON CONFLICT (id) DO NOTHING;
      ALTER TABLE members ADD COLUMN IF NOT EXISTS family_id TEXT;
      ALTER TABLE ledger ADD COLUMN IF NOT EXISTS family_id TEXT;
      ALTER TABLE claims ADD COLUMN IF NOT EXISTS family_id TEXT;
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS family_id TEXT;
      ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS family_id TEXT;
      ALTER TABLE streak_bonus_awards ADD COLUMN IF NOT EXISTS family_id TEXT;
      -- Every pre-existing row belongs to the single legacy family.
      UPDATE members SET family_id='legacy-family' WHERE family_id IS NULL;
      UPDATE ledger SET family_id='legacy-family' WHERE family_id IS NULL;
      UPDATE claims SET family_id='legacy-family' WHERE family_id IS NULL;
      UPDATE payments SET family_id='legacy-family' WHERE family_id IS NULL;
      UPDATE subscriptions SET family_id='legacy-family' WHERE family_id IS NULL;
      UPDATE streak_bonus_awards SET family_id='legacy-family' WHERE family_id IS NULL;
      ALTER TABLE members ALTER COLUMN family_id SET NOT NULL;
      ALTER TABLE ledger ALTER COLUMN family_id SET NOT NULL;
      ALTER TABLE claims ALTER COLUMN family_id SET NOT NULL;
      ALTER TABLE payments ALTER COLUMN family_id SET NOT NULL;
      ALTER TABLE subscriptions ALTER COLUMN family_id SET NOT NULL;
      ALTER TABLE streak_bonus_awards ALTER COLUMN family_id SET NOT NULL;

      -- Keep legacy single-family API writes compatible until every route is tenant-aware.
      ALTER TABLE members ALTER COLUMN family_id SET DEFAULT 'legacy-family';
      ALTER TABLE ledger ALTER COLUMN family_id SET DEFAULT 'legacy-family';
      ALTER TABLE claims ALTER COLUMN family_id SET DEFAULT 'legacy-family';
      ALTER TABLE payments ALTER COLUMN family_id SET DEFAULT 'legacy-family';
      ALTER TABLE subscriptions ALTER COLUMN family_id SET DEFAULT 'legacy-family';
      ALTER TABLE streak_bonus_awards ALTER COLUMN family_id SET DEFAULT 'legacy-family';

      CREATE INDEX IF NOT EXISTS members_family_role_idx ON members(family_id,role,name);
      CREATE INDEX IF NOT EXISTS ledger_family_created_idx ON ledger(family_id,created_at DESC,id DESC);
      CREATE INDEX IF NOT EXISTS claims_family_created_idx ON claims(family_id,id DESC);
      CREATE INDEX IF NOT EXISTS payments_family_idx ON payments(family_id,created_at DESC);
      CREATE INDEX IF NOT EXISTS subscriptions_family_idx ON subscriptions(family_id,created_at DESC);
      CREATE TABLE IF NOT EXISTS family_rules (
        family_id TEXT PRIMARY KEY REFERENCES families(id),
        jar_percent INTEGER NOT NULL, deductible_cents INTEGER NOT NULL,
        max_payout_cents INTEGER NOT NULL, streak_bonus_percent INTEGER NOT NULL DEFAULT 10,
        covered JSONB NOT NULL, excluded JSONB NOT NULL, repair_shop_email TEXT NOT NULL
      );
      INSERT INTO family_rules(family_id,jar_percent,deductible_cents,max_payout_cents,streak_bonus_percent,covered,excluded,repair_shop_email)
        SELECT 'legacy-family',jar_percent,deductible_cents,max_payout_cents,streak_bonus_percent,covered,excluded,repair_shop_email
        FROM rules WHERE id=1 ON CONFLICT (family_id) DO NOTHING;

      `);
      const count = await client.query("SELECT COUNT(*)::int AS n FROM members");
      if (Number(count.rows[0]?.n ?? 0) === 0 && process.env.PARAGUAS_SKIP_SEED !== "true") await seed(client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      schemaPromise = null;
      throw error;
    } finally {
      client.release();
    }
  })();
  return schemaPromise;
}

async function seed(client: Queryable) {
  await client.query("INSERT INTO members (id,name,role,age,allowance_cents,payout_email,emoji) VALUES ($1,$2,$3,$4,$5,$6,$7),($8,$9,$10,$11,$12,$13,$14),($15,$16,$17,$18,$19,$20,$21)",
    ["parent","Ada","parent",null,0,process.env.DEMO_PARENT_EMAIL || "parent@paraguas.test","👩🏾","tobi","Tobi","teen",15,2000,null,"🧑🏾‍🎤","zara","Zara","teen",13,1500,null,"👧🏾"]);
  await client.query("INSERT INTO rules (id,jar_percent,deductible_cents,max_payout_cents,streak_bonus_percent,covered,excluded,repair_shop_email) VALUES (1,20,500,15000,10,$1::jsonb,$2::jsonb,$3)",
    [JSON.stringify(["Accidental damage to a phone, tablet, laptop or headphones","Accidental damage to a bike or school calculator","Theft, if reported to a parent the same day"]),JSON.stringify(["Damage done on purpose","Items that were simply lost","Cosmetic scratches that don't affect use","Items lent to a friend when they broke"]),process.env.DEMO_REPAIR_SHOP_EMAIL || "repairs@fixitfast.test"]);
  // The family_rules copy in the schema step runs before seeding, so copy the seeded rules for the legacy family here.
  await client.query("INSERT INTO family_rules(family_id,jar_percent,deductible_cents,max_payout_cents,streak_bonus_percent,covered,excluded,repair_shop_email) SELECT 'legacy-family',jar_percent,deductible_cents,max_payout_cents,streak_bonus_percent,covered,excluded,repair_shop_email FROM rules WHERE id=1 ON CONFLICT (family_id) DO NOTHING");
  for (const [memberId, cents] of [["tobi",2000],["zara",1500]] as const) {
    for (let weeksAgo=12; weeksAgo>=1; weeksAgo--) {
      const jar=Math.round(cents*20/100);
      await client.query("INSERT INTO ledger (member_id,bucket,amount_cents,kind,memo,paypal_ref,created_at) VALUES ($1,'spend',$2,'allowance','Weekly allowance','SEED',NOW()+($3::int * INTERVAL '1 day')),($1,'jar',$4,'allowance','Umbrella fund share','SEED',NOW()+($3::int * INTERVAL '1 day'))",
        [memberId,cents-jar,-weeksAgo*7,jar]);
    }
  }
  await client.query("INSERT INTO ledger (member_id,bucket,amount_cents,kind,memo,created_at) VALUES ('tobi','spend',-1250,'purchase','Game top-up',NOW()-INTERVAL '9 days'),('zara','spend',-600,'purchase','Art supplies',NOW()-INTERVAL '5 days'),('tobi','jar',2500,'bonus','Parent kick-start for the umbrella fund',NOW()-INTERVAL '84 days'),('zara','jar',2500,'bonus','Parent kick-start for the umbrella fund',NOW()-INTERVAL '84 days'),('tobi','jar',800,'bonus','Parent bonus: 4-week saving streak',NOW()-INTERVAL '2 days')");
}

export async function queryRows<T = Record<string, unknown>>(text: string, values: unknown[] = [], executor?: Queryable): Promise<T[]> {
  if (!executor) await ensureSchema();
  const result = await (executor ?? getPool()).query(text, values);
  return result.rows as T[];
}
export async function execute(text: string, values: unknown[] = [], executor?: Queryable) {
  if (!executor) await ensureSchema();
  return (await (executor ?? getPool()).query(text, values)).rowCount ?? 0;
}
export async function withTransaction<T>(work: (client: Queryable) => Promise<T>): Promise<T> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function getRules(executor?:Queryable,familyId="legacy-family"): Promise<Rules> {
  const [r]=await queryRows<any>("SELECT * FROM family_rules WHERE family_id=$1",[familyId],executor);
  if(!r) throw new Error("Family rules are not configured");
  return {jar_percent:r.jar_percent,deductible_cents:r.deductible_cents,max_payout_cents:r.max_payout_cents,
    streak_bonus_percent:r.streak_bonus_percent,covered:Array.isArray(r.covered)?r.covered:JSON.parse(r.covered),
    excluded:Array.isArray(r.excluded)?r.excluded:JSON.parse(r.excluded),repair_shop_email:r.repair_shop_email};
}
export async function updateRules(patch:Partial<Rules>,familyId="legacy-family") {
  const next={...(await getRules(undefined,familyId)),...patch};
  await execute("UPDATE family_rules SET jar_percent=$1,deductible_cents=$2,max_payout_cents=$3,streak_bonus_percent=$4,covered=$5::jsonb,excluded=$6::jsonb,repair_shop_email=$7 WHERE family_id=$8",
    [next.jar_percent,next.deductible_cents,next.max_payout_cents,next.streak_bonus_percent,JSON.stringify(next.covered),JSON.stringify(next.excluded),next.repair_shop_email,familyId]);
  return next;
}
export async function getMembers(familyId="legacy-family"): Promise<Member[]> { return queryRows<Member>("SELECT * FROM members WHERE family_id=$1 ORDER BY role,name",[familyId]); }
export async function getMember(id:string,executor?:Queryable,familyId="legacy-family"): Promise<Member|undefined> { return (await queryRows<Member>("SELECT * FROM members WHERE id=$1 AND family_id=$2",[id,familyId],executor))[0]; }
export async function getTeens(familyId="legacy-family"): Promise<Member[]> { return (await getMembers(familyId)).filter(m=>m.role==="teen"); }
export async function balances(memberId:string,executor?:Queryable,familyId="legacy-family") {
  const rows=await queryRows<{bucket:string;total:number}>("SELECT bucket,COALESCE(SUM(amount_cents),0)::int AS total FROM ledger WHERE member_id=$1 AND family_id=$2 GROUP BY bucket",[memberId,familyId],executor);
  const out={spend:0,jar:0}; for(const r of rows) out[r.bucket as "spend"|"jar"]=Number(r.total); return out;
}
export async function addLedger(e:Omit<LedgerEntry,"id"|"created_at">,executor?:Queryable,familyId="legacy-family") {
  await execute("INSERT INTO ledger(member_id,bucket,amount_cents,kind,memo,paypal_ref,family_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [e.member_id,e.bucket,e.amount_cents,e.kind,e.memo,e.paypal_ref,familyId],executor);
}
export async function getLedger(memberId?:string,limit=50,familyId="legacy-family"):Promise<LedgerEntry[]> {
  return memberId
    ? queryRows<LedgerEntry>("SELECT * FROM ledger WHERE member_id=$1 AND family_id=$2 ORDER BY created_at DESC,id DESC LIMIT $3",[memberId,familyId,limit])
    : queryRows<LedgerEntry>("SELECT * FROM ledger WHERE family_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2",[familyId,limit]);
}
export async function getClaims(memberId?:string,familyId="legacy-family"):Promise<Claim[]> {
  return memberId ? queryRows<Claim>("SELECT * FROM claims WHERE member_id=$1 AND family_id=$2 ORDER BY id DESC",[memberId,familyId])
    : queryRows<Claim>("SELECT * FROM claims WHERE family_id=$1 ORDER BY id DESC",[familyId]);
}
export async function getClaim(id:number,familyId="legacy-family"):Promise<Claim|undefined> { return (await queryRows<Claim>("SELECT * FROM claims WHERE id=$1 AND family_id=$2",[id,familyId]))[0]; }

export async function insertClaim(input:{member_id:string;family_id?:string;title:string;description:string;amount_cents:number;photo_file:string|null;photo_mime:string|null;ai:unknown}) {
  const [claim]=await queryRows<Claim>("INSERT INTO claims(member_id,family_id,title,description,amount_cents,photo_file,photo_mime,status,ai) VALUES($1,$2,$3,$4,$5,$6,$7,'pending_parent',$8) RETURNING *",
    [input.member_id,input.family_id||"legacy-family",input.title,input.description,input.amount_cents,input.photo_file,input.photo_mime,JSON.stringify(input.ai)]);
  return claim;
}
export async function setAllowance(memberId:string,cents:number,familyId="legacy-family") {
  return execute("UPDATE members SET allowance_cents=$1 WHERE id=$2 AND role='teen' AND family_id=$3",[cents,memberId,familyId]);
}

export type FamilyAccount = { id:string; code:string; parent_name:string; password_hash:string };
function makeFamilyCode() {
  const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; const bytes=randomBytes(8);
  let value=""; for(const byte of bytes)value+=alphabet[byte%alphabet.length];
  return `FAM-${value.slice(0,4)}-${value.slice(4)}`;
}
export async function createFamilyAccount(parentName:string,passwordHash:string) {
  const name=parentName.trim().slice(0,80);
  if(name.length<2||passwordHash.length<40)throw new Error("A valid parent name and password hash are required");
  return withTransaction(async client=>{
    const id=randomUUID(); let code="";
    for(let attempt=0;attempt<5;attempt++){const candidate=makeFamilyCode();const exists=await queryRows("SELECT 1 FROM families WHERE code=$1",[candidate],client);if(!exists.length){code=candidate;break;}}
    if(!code)throw new Error("Could not generate a family code. Please try again.");
    await execute("INSERT INTO families(id,code,parent_name,password_hash) VALUES($1,$2,$3,$4)",[id,code,name,passwordHash],client);
    await execute("INSERT INTO members(id,name,role,age,allowance_cents,payout_email,emoji,family_id) VALUES($1,$2,'parent',NULL,0,NULL,'👨‍👩‍👧',$3)",[`parent_${id}`,name,id],client);
    await execute(`INSERT INTO family_rules(family_id,jar_percent,deductible_cents,max_payout_cents,streak_bonus_percent,covered,excluded,repair_shop_email)
      SELECT $1,jar_percent,deductible_cents,max_payout_cents,streak_bonus_percent,covered,excluded,repair_shop_email FROM rules WHERE id=1 ON CONFLICT(family_id) DO NOTHING`,[id],client);
    return {id,code,parent_name:name};
  });
}
export async function getFamilyByCode(code:string) {
  return (await queryRows<FamilyAccount>("SELECT id,code,parent_name,password_hash FROM families WHERE code=$1",[code.trim().toUpperCase()]))[0];
}
export async function addTeenToFamily(familyId:string,name:string,pinHash:string) {
  const clean=name.trim().slice(0,80); if(!clean||pinHash.length<40)throw new Error("A valid teen name and PIN hash are required");
  const id=randomUUID();
  await withTransaction(async client=>{
    const family=await queryRows("SELECT id FROM families WHERE id=$1 FOR UPDATE",[familyId],client);
    if(!family.length)throw new Error("Family not found");
    await execute("INSERT INTO members(id,name,role,age,allowance_cents,payout_email,emoji,family_id,pin_hash) VALUES($1,$2,'teen',NULL,0,NULL,'🙂',$3,$4)",[id,clean,familyId,pinHash],client);
  });
  return {id,name:clean,role:"teen" as const};
}
export async function getFamilyMember(id:string,familyId:string) {
  return (await queryRows<Member>("SELECT * FROM members WHERE id=$1 AND family_id=$2",[id,familyId]))[0];
}

export async function consumeRateLimit(rateKey:string,limit:number,windowMs:number) {
  if(!rateKey||!Number.isSafeInteger(limit)||limit<1||!Number.isSafeInteger(windowMs)||windowMs<1) throw new Error("Invalid rate-limit configuration");
  const now=Date.now();
  const [row]=await queryRows<{window_started_at:string|number;attempts:number}>(
    `INSERT INTO login_rate_limits(rate_key,window_started_at,attempts) VALUES($1,$2,1)
     ON CONFLICT(rate_key) DO UPDATE SET
       window_started_at=CASE WHEN $2-login_rate_limits.window_started_at >= $3 THEN $2 ELSE login_rate_limits.window_started_at END,
       attempts=CASE WHEN $2-login_rate_limits.window_started_at >= $3 THEN 1 ELSE login_rate_limits.attempts+1 END
     RETURNING window_started_at,attempts`,[rateKey,now,windowMs]);
  const started=Number(row.window_started_at);
  const attempts=Number(row.attempts);
  const allowed=attempts<=limit;
  return {allowed,remaining:Math.max(0,limit-attempts),retryAfterSeconds:allowed?0:Math.max(1,Math.ceil((started+windowMs-now)/1000))};
}
export async function saveSubscription(subscriptionId:string,memberId:string,amountCents:number) {
  const [owner]=await queryRows<{family_id:string}>("SELECT family_id FROM members WHERE id=$1",[memberId]);
  await execute("INSERT INTO subscriptions(subscription_id,member_id,amount_cents,status,family_id) VALUES($1,$2,$3,'APPROVAL_PENDING',$4)",[subscriptionId,memberId,amountCents,owner?.family_id ?? "legacy-family"]);
}
export async function updateSubscriptionStatus(subscriptionId:string,status:string,familyId?:string) {
  await execute("UPDATE subscriptions SET status=$1 WHERE subscription_id=$2 AND ($3::text IS NULL OR family_id=$3)",[status,subscriptionId,familyId??null]);
}
export async function recordSubscriptionPayment(input:{eventId:string;eventType:string;subscriptionId:string;saleId:string;amountCents:number}) {
  return withTransaction(async client=>{
    const [sub]=await queryRows<{member_id:string;amount_cents:number}>("SELECT member_id,amount_cents FROM subscriptions WHERE subscription_id=$1 FOR UPDATE",[input.subscriptionId],client);
    if(!sub) throw new Error("PayPal subscription is not linked to a Paraguas family member");
    if(input.amountCents!==sub.amount_cents) throw new Error("PayPal subscription payment amount does not match the allowance");
    const event=await queryRows("INSERT INTO paypal_webhook_events(event_id,event_type) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING event_id",[input.eventId,input.eventType],client);
    if(!event.length) return {credited:false,duplicate:true};
    const [owner]=await queryRows<{family_id:string}>("SELECT family_id FROM members WHERE id=$1",[sub.member_id],client);
    const payment=await queryRows("INSERT INTO payments(order_id,member_id,amount_cents,method,status,family_id) VALUES($1,$2,$3,'subscription','COMPLETED',$4) ON CONFLICT DO NOTHING RETURNING order_id",
      [input.saleId,sub.member_id,input.amountCents,owner?.family_id ?? "legacy-family"],client);
    if(!payment.length) return {credited:false,duplicate:true};
    await creditAllowance(sub.member_id,input.amountCents,input.saleId,"Weekly allowance (PayPal subscription)",client);
    return {credited:true,duplicate:false};
  });
}
export async function recordMockSubscriptionPayment(subscriptionId:string,familyId?:string) {
  const [sub]=await queryRows<{amount_cents:number}>("SELECT amount_cents FROM subscriptions WHERE subscription_id=$1 AND ($2::text IS NULL OR family_id=$2)",[subscriptionId,familyId??null]);
  if(!sub) throw new Error("Mock subscription is not registered");
  return recordSubscriptionPayment({eventId:`mock-event-${subscriptionId}`,eventType:"PAYMENT.SALE.COMPLETED",subscriptionId,saleId:`mock-sale-${subscriptionId}`,amountCents:sub.amount_cents});
}

export type StreakStatus={weeks:number;bonusCents:number;eligible:boolean;alreadyMatched:boolean;endWeek:string|null};
export async function getStreakStatus(memberId:string,executor?:Queryable,familyId="legacy-family"):Promise<StreakStatus> {
  const rows=await queryRows<{week_start:string;contributed:number}>(
    `SELECT date_trunc('week',created_at AT TIME ZONE 'UTC')::date::text AS week_start,SUM(amount_cents)::int AS contributed
     FROM ledger WHERE member_id=$1 AND family_id=$2 AND bucket='jar' AND kind='allowance' AND amount_cents>0\n     GROUP BY 1 ORDER BY 1 DESC LIMIT 52`,[memberId,familyId],executor);
  if(!rows.length) return {weeks:0,bonusCents:0,eligible:false,alreadyMatched:false,endWeek:null};
  const latest=new Date(rows[0].week_start+"T00:00:00Z");
  const now=new Date(); const monday=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate()-((monday.getUTCDay()+6)%7));
  if((monday.getTime()-latest.getTime())/86400000>7) return {weeks:0,bonusCents:0,eligible:false,alreadyMatched:false,endWeek:rows[0].week_start};
  let weeks=1;
  for(let i=1;i<rows.length;i++){const prev=new Date(rows[i-1].week_start+"T00:00:00Z");const next=new Date(rows[i].week_start+"T00:00:00Z");if((prev.getTime()-next.getTime())/86400000!==7)break;weeks++;}
  const endWeek=rows[0].week_start;
  const match=await queryRows("SELECT 1 FROM streak_bonus_awards WHERE member_id=$1 AND streak_end_week=$2 AND status IN ('PENDING','COMPLETED')",[memberId,endWeek],executor);
  const alreadyMatched=match.length>0; const eligible=weeks>=4&&!alreadyMatched;
  const contributed=rows.slice(0,4).reduce((sum,row)=>sum+Number(row.contributed),0);
  const bonusCents=eligible?Math.round(contributed*(await getRules(executor,familyId)).streak_bonus_percent/100):0;
  return {weeks,bonusCents,eligible,alreadyMatched,endWeek};
}
export async function reserveStreakBonus(memberId:string,endWeek:string,orderId:string,amountCents:number,executor?:Queryable,familyId="legacy-family") {
  const rows=await queryRows("INSERT INTO streak_bonus_awards(member_id,streak_end_week,order_id,amount_cents,status,family_id) VALUES($1,$2,$3,$4,'PENDING',$5) ON CONFLICT(member_id,streak_end_week) DO UPDATE SET order_id=EXCLUDED.order_id,amount_cents=EXCLUDED.amount_cents,status=EXCLUDED.status,family_id=EXCLUDED.family_id WHERE streak_bonus_awards.status='CANCELLED' RETURNING order_id",
    [memberId,endWeek,orderId,amountCents,familyId],executor);
  if(!rows.length) throw new Error("Saving streak match is already reserved or completed");
}
export async function creditAllowance(memberId:string,cents:number,ref:string,label:string,executor?:Queryable) {
  // Credit the teen's own family, not the legacy default (PayPal webhooks carry no session).
  const [owner]=await queryRows<{family_id:string}>("SELECT family_id FROM members WHERE id=$1",[memberId],executor);
  const familyId=owner?.family_id ?? "legacy-family";
  const {jar_percent}=await getRules(executor,familyId); const jar=Math.round(cents*jar_percent/100);
  await addLedger({member_id:memberId,bucket:"spend",amount_cents:cents-jar,kind:"allowance",memo:label,paypal_ref:ref},executor,familyId);
  await addLedger({member_id:memberId,bucket:"jar",amount_cents:jar,kind:"allowance",memo:`Umbrella fund share (${jar_percent}%)`,paypal_ref:ref},executor,familyId);
  return {spend:cents-jar,jar};
}
export async function familySnapshot(familyId="legacy-family") {
  const teens=await getTeens(familyId);
  return {teens:await Promise.all(teens.map(async t=>({...t,balances:await balances(t.id,undefined,familyId)}))),rules:await getRules(undefined,familyId)};
}
export async function cancelStreakBonus(orderId:string) {
  return withTransaction(async client=>{
    const changed=await execute("UPDATE payments SET status='CANCELLED' WHERE order_id=$1 AND method='streak_bonus' AND status='CREATED'",[orderId],client);
    if(changed) await execute("UPDATE streak_bonus_awards SET status='CANCELLED' WHERE order_id=$1 AND status='PENDING'",[orderId],client);
    return changed>0;
  });
}

/** Test-only injection point; production always uses DATABASE_URL and Neon Pool. */
export function setPoolForTests(value: unknown) {
  pool = value as PoolLike;
  schemaPromise = null;
}
