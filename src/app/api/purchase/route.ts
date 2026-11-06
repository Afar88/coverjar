import { addLedger, balances, getMember, withTransaction } from "@/lib/db";
import { toCents } from "@/lib/money";
import { requireRole } from "@/lib/auth";

export async function POST(req:Request) {
  const session=requireRole(req,"teen");
  if(!session)return Response.json({error:"Teen access required"},{status:403});
  let body:{amount?:unknown;memo?:unknown};
  try{body=await req.json();}catch{return Response.json({error:"Invalid request body"},{status:400});}
  const teen=await getMember(session.memberId,undefined,session.familyId); const cents=toCents(body.amount);
  if(!teen||teen.role!=="teen")return Response.json({error:"Unknown teen"},{status:400});
  if(!(cents>0))return Response.json({error:"Enter an amount"},{status:400});
  try {
    const result=await withTransaction(async client=>{
      await client.query("SELECT id FROM members WHERE id=$1 FOR UPDATE",[teen.id]);
      if(cents>(await balances(teen.id,client,session.familyId)).spend)throw new Error("Not enough spending money");
      await addLedger({member_id:teen.id,bucket:"spend",amount_cents:-cents,kind:"purchase",memo:String(body.memo||"Purchase").slice(0,80),paypal_ref:null},client,session.familyId);
      return balances(teen.id,client);
    });
    return Response.json(result);
  } catch(e) {
    const message=(e as Error).message;
    return Response.json({error:message},{status:message==="Not enough spending money"?400:500});
  }
}
