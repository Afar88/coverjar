import { consumeRateLimit, getFamilyByCode, getMembers } from "@/lib/db";
export async function GET(req:Request) {
  const code=(new URL(req.url).searchParams.get("familyCode")||"").trim().toUpperCase();
  if(!code)return Response.json({teens:[]},{headers:{"Cache-Control":"no-store"}});
  const rate=await consumeRateLimit("family-options:"+code,20,60*1000);
  if(!rate.allowed)return Response.json({error:"Too many attempts. Try again shortly."},{status:429,headers:{"Retry-After":String(rate.retryAfterSeconds),"Cache-Control":"no-store"}});
  const family=await getFamilyByCode(code);
  if(!family)return Response.json({teens:[]},{headers:{"Cache-Control":"no-store"}});
  const members=await getMembers(family.id);
  return Response.json({teens:members.filter(m=>m.role==="teen").map(({id,name,emoji})=>({id,name,emoji}))},{headers:{"Cache-Control":"no-store"}});
}
