import { addLedger, getClaim, queryRows, withTransaction } from "@/lib/db";
import { getPayoutStatus, sendPayout } from "@/lib/paypal";
import { requireRole } from "@/lib/auth";

export async function POST(req:Request,ctx:{params:Promise<{id:string}>}) {
  const session=requireRole(req,"parent");
  if(!session)return Response.json({error:"Parent access required"},{status:403});
  const {id}=await ctx.params;const claimId=Number(id);
  if(!Number.isSafeInteger(claimId)||claimId<=0)return Response.json({error:"Invalid claim id"},{status:400});
  const claim=await getClaim(claimId,session.familyId);
  if(!claim)return Response.json({error:"Claim not found"},{status:404});
  if(claim.status!=="payout_pending")return Response.json({error:"This claim has no payout awaiting reconciliation"},{status:409});
  if(!claim.payout_cents||!claim.payee_email)return Response.json({error:"Payout details are incomplete; the reservation remains in place"},{status:409});
  let batchId=claim.paypal_ref;
  if(!batchId){
    try{
      const recovered=await sendPayout({email:claim.payee_email,cents:claim.payout_cents,note:`Paraguas claim #${claim.id}: ${claim.title}`,itemId:`claim-${claim.id}`});
      batchId=recovered.batchId;
      await queryRows("UPDATE claims SET paypal_ref=$1 WHERE id=$2 AND family_id=$3 AND status='payout_pending' AND paypal_ref IS NULL RETURNING id",[batchId,claim.id,session.familyId]);
    }catch(error){
      return Response.json({...await getClaim(claim.id,session.familyId),payoutStatus:"UNKNOWN",message:`Could not recover the original PayPal request yet. Funds remain reserved. Try checking again: ${(error as Error).message}`},{status:202});
    }
  }
  let status:{batchStatus:string;itemStatus:string};
  try{status=await getPayoutStatus(batchId,`claim-${claim.id}`);}
  catch(error){return Response.json({error:`Could not check PayPal yet: ${(error as Error).message}`},{status:502});}
  const succeeded=status.batchStatus==="SUCCESS"&&status.itemStatus==="SUCCESS";
  const failed=["DENIED","CANCELED","CANCELLED"].includes(status.batchStatus)||["FAILED","RETURNED","BLOCKED","REFUNDED"].includes(status.itemStatus);
  if(!succeeded&&!failed)return Response.json({...await getClaim(claim.id,session.familyId),payoutStatus:status.itemStatus,batchStatus:status.batchStatus,message:"PayPal has not confirmed a final outcome. The funds remain reserved; check again shortly."},{status:202});
  const updated=await withTransaction(async client=>{
    const [current]=await queryRows<{status:string;paypal_ref:string|null}>("SELECT status,paypal_ref FROM claims WHERE id=$1 AND family_id=$2 FOR UPDATE",[claim.id,session.familyId],client);
    if(!current||current.status!=="payout_pending"||current.paypal_ref!==batchId)return false;
    if(succeeded){
      const changed=await queryRows("UPDATE claims SET status='paid',decided_at=NOW() WHERE id=$1 AND family_id=$3 AND status='payout_pending' AND paypal_ref=$2 RETURNING id",[claim.id,batchId,session.familyId],client);
      return changed.length>0;
    }
    const changed=await queryRows("UPDATE claims SET status='payout_failed',decided_at=NOW() WHERE id=$1 AND family_id=$3 AND status='payout_pending' AND paypal_ref=$2 RETURNING id",[claim.id,batchId,session.familyId],client);
    if(changed.length)await addLedger({member_id:claim.member_id,bucket:"jar",amount_cents:claim.payout_cents!,kind:"claim_release",memo:`Released failed claim reservation: ${claim.title}`,paypal_ref:batchId},client,session.familyId);
    return changed.length>0;
  });
  if(!updated)return Response.json({error:"Claim changed while checking PayPal. Refresh and review its current status."},{status:409});
  return Response.json({...await getClaim(claim.id,session.familyId),payoutStatus:status.itemStatus,batchStatus:status.batchStatus});
}
