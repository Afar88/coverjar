import { requireRole, hashSecret } from "@/lib/auth";
import { addTeenToFamily, consumeRateLimit } from "@/lib/db";

export async function POST(req:Request) {
  const session=requireRole(req,"parent");
  if(!session)return Response.json({error:"Parent access required"},{status:403});
  let body:{name?:string;pin?:string};
  try{body=await req.json();}catch{return Response.json({error:"Invalid request"},{status:400});}
  const name=String(body.name||"").trim();
  const pin=String(body.pin||"");
  if(name.length<1||name.length>80)return Response.json({error:"Enter the teen's name."},{status:400});
  if(!/^\d{4,12}$/.test(pin))return Response.json({error:"PIN must be 4–12 digits."},{status:400});
  const rate=await consumeRateLimit("add-teen:"+session.familyId,20,60*60*1000);
  if(!rate.allowed)return Response.json({error:"Too many teen profiles created. Try again later."},{status:429});
  const teen=await addTeenToFamily(session.familyId,name,await hashSecret(pin));
  return Response.json({teen},{status:201,headers:{"Cache-Control":"no-store"}});
}
