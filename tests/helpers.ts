import { newDb } from "pg-mem";
import { queryRows, setPoolForTests } from "../src/lib/db";

export async function createTestDatabase() {
  process.env.PARAGUAS_SKIP_SEED="true";
  const memory=newDb({autoCreateForeignKeyIndices:true});
  const adapter=memory.adapters.createPg();
  const pool=new adapter.Pool();
  setPoolForTests(pool);
  await queryRows("SELECT 1");
  await queryRows("INSERT INTO members(id,name,role,age,allowance_cents,payout_email,emoji) VALUES('parent','Ada','parent',NULL,0,'parent@example.test','👩🏾'),('tobi','Tobi','teen',15,2000,NULL,'🧑🏾‍🎤'),('zara','Zara','teen',13,1500,NULL,'👧🏾')");
  await queryRows("INSERT INTO rules(id,jar_percent,deductible_cents,max_payout_cents,streak_bonus_percent,covered,excluded,repair_shop_email) VALUES(1,20,500,15000,10,'[]'::jsonb,'[]'::jsonb,'repairs@example.test')");
  await queryRows("INSERT INTO ledger(member_id,bucket,amount_cents,kind,memo) VALUES('tobi','jar',3000,'bonus','Test balance'),('tobi','spend',3000,'allowance','Test spend'),('zara','jar',3000,'bonus','Test balance')");
  return {pool,memory};
}
