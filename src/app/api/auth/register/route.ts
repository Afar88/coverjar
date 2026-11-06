import { hashSecret, createSession, sessionCookie } from "@/lib/auth";
import { createFamilyAccount, consumeRateLimit } from "@/lib/db";

export async function POST(req:Request) {
  let body:{name?:string;password?:string};
  try{body=await req.json();}catch{return Response.json({error:"Invalid request"},{status:400});}
  const name=String(body.name||"").trim();
  const password=String(body.password||"");
  if(name.length<2||name.length>80)return Response.json({error:"Enter your name (2–80 characters)."},{status:400});
  if(password.length<10||password.length>128)return Response.json({error:"Use a password with at least 10 characters."},{status:400});
  const rate=await consumeRateLimit("family-register:"+name.toLowerCase(),4,60*60*1000);
  if(!rate.allowed)return Response.json({error:"Too many registration attempts. Try again later."},{status:429});
  const passwordHash=await hashSecret(password);
  const family=await createFamilyAccount(name,passwordHash);
  const memberId="parent_"+family.id;
  const token=createSession("parent",memberId,family.id);
  return Response.json({role:"parent",memberId,familyId:family.id,familyCode:family.code,parentName:family.parent_name},{status:201,headers:{"Set-Cookie":sessionCookie(token),"Cache-Control":"no-store"}});
}
