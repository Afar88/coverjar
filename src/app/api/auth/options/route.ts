import { getFamilyByCode, getMembers } from "@/lib/db";
export async function GET(req:Request) {
  const code=new URL(req.url).searchParams.get("familyCode")||"";
  if(!code)return Response.json({teens:[]},{headers:{"Cache-Control":"no-store"}});
  const family=await getFamilyByCode(code);
  if(!family)return Response.json({teens:[]},{headers:{"Cache-Control":"no-store"}});
  const members=await getMembers(family.id);
  return Response.json({teens:members.filter(m=>m.role==="teen").map(({id,name,emoji})=>({id,name,emoji}))},{headers:{"Cache-Control":"no-store"}});
}
