import { addLedger, balances, getClaim, getMember, getRules, queryRows, withTransaction } from "@/lib/db";
import { toCents } from "@/lib/money";
import { sendPayout } from "@/lib/paypal";
import { requireRole } from "@/lib/auth";

export async function POST(req:Request,ctx:{params:Promise<{id:string}>}) {
  if(!requireRole(req,"parent"))return Response.json({error:"Parent access required"},{status:403});
  const {id}=await ctx.params;const claimId=Number(id);
  if(!Number.isSafeInteger(claimId)||claimId<=0)return Response.json({error:"Invalid claim id"},{status:400});
  let body:{decision?:string;amount?:unknown;payee?:string;note?:string};
  try{body=await req.json();}catch{return Response.json({error:"Invalid request body"},{status:400});}
  const claim=await getClaim(claimId);
  if(!claim)return Response.json({error:"Claim not found"},{status:404});
  if(body.decision==="deny"){
    const changed=await queryRows("UPDATE claims SET status='denied',parent_note=$1,decided_at=NOW() WHERE id=$2 AND status='pending_parent' RETURNING id",
      [typeof body.note==="string"?body.note.slice(0,500):null,claim.id]);
    if(!changed.length)return Response.json({error:"Claim already decided or payout is in progress"},{status:409});
    return Response.json(await getClaim(claim.id));
  }
  if(body.decision!=="approve")return Response.json({error:"Choose approve or deny"},{status:400});
  const cents=toCents(body.amount);const rules=await getRules();
  if(!(cents>0))return Response.json({error:"Enter a payout amount"},{status:400});
  if(cents>rules.max_payout_cents)return Response.json({error:"Above the family max payout"},{status:400});
  if(cents>claim.amount_cents)return Response.json({error:"Payout cannot exceed the amount requested in this claim"},{status:400});
  const parent=await getMember("parent");
  if(!parent)return Response.json({error:"Parent account is missing"},{status:500});
  const email=body.payee==="parent"?parent.payout_email||"parent@paraguas.test":rules.repair_shop_email;
  const note=typeof body.note==="string"?body.note.slice(0,500):null;
  try {
    await withTransaction(async client=>{
      await client.query("SELECT id FROM members WHERE id=$1 FOR UPDATE",[claim.member_id]);
      if(cents>(await balances(claim.member_id,client)).jar)throw new Error("Not enough in the umbrella fund");
      const locked=await queryRows("UPDATE claims SET status='payout_pending',payout_cents=$1,payee_email=$2,parent_note=$3,decided_at=NOW() WHERE id=$4 AND status='pending_parent' RETURNING id",
        [cents,email,note,claim.id],client);
      if(!locked.length)throw new Error("Claim already decided");
      await addLedger({member_id:claim.member_id,bucket:"jar",amount_cents:-cents,kind:"claim_reserve",memo:`Reserved for claim payout: ${claim.title}`,paypal_ref:null},client);
    });
  } catch(e) {
    const message=(e as Error).message;
    return Response.json({error:message},{status:message==="Not enough in the umbrella fund"?400:409});
  }
  try {
    const payout=await sendPayout({email,cents,note:`Paraguas claim #${claim.id}: ${claim.title}`,itemId:`claim-${claim.id}`});
    if(payout.status==="DENIED"||payout.status==="CANCELED"){
      await withTransaction(async client=>{
        const changed=await queryRows("UPDATE claims SET status='payout_failed',paypal_ref=$1 WHERE id=$2 AND status='payout_pending' RETURNING id",[payout.batchId,claim.id],client);
        if(changed.length)await addLedger({member_id:claim.member_id,bucket:"jar",amount_cents:cents,kind:"claim_release",memo:`Released failed claim reservation: ${claim.title}`,paypal_ref:payout.batchId},client);
      });
      return Response.json({...await getClaim(claim.id),payoutStatus:payout.status},{status:502});
    }
    if(payout.status!=="SUCCESS"&&payout.status!=="SUCCESS (simulated)"){
      await queryRows("UPDATE claims SET paypal_ref=$1 WHERE id=$2 AND status='payout_pending'",[payout.batchId,claim.id]);
      return Response.json({...await getClaim(claim.id),payoutStatus:payout.status,message:"PayPal is still processing this payout."},{status:202});
    }
    await queryRows("UPDATE claims SET status='paid',paypal_ref=$1,decided_at=NOW() WHERE id=$2 AND status='payout_pending'",[payout.batchId,claim.id]);
    return Response.json({...await getClaim(claim.id),payoutStatus:payout.status});
  } catch(e) {
    return Response.json({...await getClaim(claim.id),payoutStatus:"UNKNOWN",message:`Payout outcome needs reconciliation before retrying: ${(e as Error).message}`},{status:202});
  }
}
