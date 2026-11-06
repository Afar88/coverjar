import { getMember, saveSubscription } from "@/lib/db";
import { createAllowanceSubscription } from "@/lib/paypal";
import { requireRole } from "@/lib/auth";

export async function POST(req:Request) {
  const session=requireRole(req,"parent");
  if(!session)return Response.json({error:"Parent access required"},{status:403});
  let body:{memberId?:string};
  try{body=await req.json();}catch{return Response.json({error:"Invalid request body"},{status:400});}
  const teen=await getMember(String(body.memberId||""),undefined,session.familyId);
  if(!teen||teen.role!=="teen")return Response.json({error:"Unknown teen"},{status:400});
  const origin=new URL(req.url).origin;
  try {
    const sub=await createAllowanceSubscription({teenName:teen.name,cents:teen.allowance_cents,returnUrl:`${origin}/api/subscribe/return?member=${teen.id}`,cancelUrl:`${origin}/?subscribe=cancelled`});
    await saveSubscription(sub.id,teen.id,teen.allowance_cents);
    return Response.json(sub);
  } catch(e){console.error("PayPal subscription creation failed:",e);return Response.json({error:"Could not start the PayPal subscription. Please try again."},{status:502,headers:{"Cache-Control":"no-store"}});}
}
