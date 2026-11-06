import { getMember, getStreakStatus, reserveStreakBonus, withTransaction } from "@/lib/db";
import { toCents } from "@/lib/money";
import { createOrder, cryptoEnabled } from "@/lib/paypal";
import { requireRole } from "@/lib/auth";

export async function POST(req:Request) {
  const session=requireRole(req,"parent");
  if(!session)return Response.json({error:"Parent access required"},{status:403});
  let body:{memberId?:unknown;amount?:unknown;method?:unknown};
  try{body=await req.json();}catch{return Response.json({error:"Invalid request body"},{status:400});}
  const memberId=typeof body.memberId==="string"?body.memberId:""; const method=body.method;
  if(method!==undefined&&method!=="paypal"&&method!=="crypto"&&method!=="streak_bonus")return Response.json({error:"Unsupported payment method"},{status:400});
  if(method==="crypto"&&!cryptoEnabled)return Response.json({error:"PayPal crypto payments are not enabled for this app"},{status:403});
  const teen=await getMember(memberId,undefined,session.familyId); let cents=toCents(body.amount);
  if(!teen||teen.role!=="teen")return Response.json({error:"Unknown teen"},{status:400});
  let streakEndWeek:string|null=null;
  if(method==="streak_bonus"){
    const streak=await getStreakStatus(teen.id,session.familyId);
    if(!streak.eligible||!streak.endWeek)return Response.json({error:"This teen has no unmatched four-week saving streak yet."},{status:409});
    cents=streak.bonusCents; streakEndWeek=streak.endWeek;
    if(!(cents>=100&&cents<=50000))return Response.json({error:"The calculated match must be between $1 and $500. Check the family match percentage."},{status:400});
  } else if(!(cents>=100&&cents<=50000))return Response.json({error:"Amount must be between $1 and $500"},{status:400});
  const origin=new URL(req.url).origin;
  try {
    const order=await createOrder({cents,description:method==="streak_bonus"?`Paraguas saving streak match for ${teen.name}`:`Paraguas allowance for ${teen.name}`,referenceId:teen.id,
      crypto:method==="crypto"?{givenName:"Ada",surname:"Parent",returnUrl:`${origin}/api/topup/crypto-return`,cancelUrl:`${origin}/?topup=cancelled`}:undefined});
    await withTransaction(async client=>{
      await client.query("INSERT INTO payments(order_id,member_id,amount_cents,method,status,family_id) VALUES($1,$2,$3,$4,'CREATED',$5)",
        [order.id,teen.id,cents,method==="crypto"?"crypto":method==="streak_bonus"?"streak_bonus":"paypal",session.familyId]);
      if(method==="streak_bonus"){
        const latest=await getStreakStatus(teen.id,session.familyId,client);
        if(!latest.eligible||latest.endWeek!==streakEndWeek||latest.bonusCents!==cents)throw new Error("Saving streak changed before the match could be reserved.");
        await reserveStreakBonus(teen.id,latest.endWeek!,order.id,cents,session.familyId,client);
      }
    });
    return Response.json(order);
  } catch(e){return Response.json({error:(e as Error).message},{status:502});}
}
