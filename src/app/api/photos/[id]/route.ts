import { getClaim } from "@/lib/db";
import { readClaimPhoto } from "@/lib/storage";
import { requireRole } from "@/lib/auth";

export async function GET(req:Request,ctx:{params:Promise<{id:string}>}) {
  const session=requireRole(req);
  if(!session)return new Response("Unauthorized",{status:401,headers:{"Cache-Control":"no-store"}});
  const {id}=await ctx.params;const claimId=Number(id);
  if(!Number.isSafeInteger(claimId)||claimId<=0)return new Response("Not found",{status:404});
  const claim=await getClaim(claimId,session.familyId);
  if(!claim?.photo_file||(session.role==="teen"&&claim.member_id!==session.memberId))return new Response("Not found",{status:404});
  if(claim.photo_mime!=="image/jpeg"&&claim.photo_mime!=="image/png"&&claim.photo_mime!=="image/webp")return new Response("Unsupported image",{status:415});
  try {
    const blob=await readClaimPhoto(claim.photo_file,claim.member_id,session.familyId);
    if(!blob||blob.statusCode!==200)return new Response("Photo unavailable",{status:404,headers:{"Cache-Control":"no-store"}});
    return new Response(blob.stream,{headers:{"Content-Type":claim.photo_mime,"Content-Length":String(blob.blob.size),"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
  } catch{return new Response("Photo unavailable",{status:404,headers:{"Cache-Control":"no-store"}});}
}
