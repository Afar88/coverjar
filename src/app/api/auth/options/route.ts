import { getMembers } from "@/lib/db";
export async function GET() {
  const members=await getMembers();
  return Response.json({teens:members.filter(m=>m.role==="teen").map(({id,name,emoji})=>({id,name,emoji}))},{headers:{"Cache-Control":"no-store"}});
}
