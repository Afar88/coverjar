import { balances, consumeRateLimit, getClaims, getMember, getRules, insertClaim } from "@/lib/db";
import { toCents } from "@/lib/money";
import { assessClaim } from "@/lib/gemini";
import { deleteClaimPhoto, detectClaimPhoto, isMemberClaimPhotoPath, MAX_CLAIM_PHOTO_BYTES, readClaimPhoto } from "@/lib/storage";
import { requireRole } from "@/lib/auth";

export async function POST(req:Request) {
  const session=requireRole(req,"teen");
  if(!session)return Response.json({error:"Teen access required"},{status:403});
  const rate=await consumeRateLimit(`claim-submit:${session.memberId}`,5,60*60*1000);
  if(!rate.allowed)return Response.json({error:"Too many claim submissions. Please try again later."},{status:429,headers:{"Retry-After":String(rate.retryAfterSeconds),"Cache-Control":"no-store"}});
  const contentLength=Number(req.headers.get("content-length")||0);
  if(contentLength>128*1024)return Response.json({error:"Claim details are too large."},{status:413});
  let form:FormData;
  try{form=await req.formData();}catch{return Response.json({error:"Invalid claim form"},{status:400});}
  const teen=await getMember(session.memberId);
  const title=String(form.get("title")||"").trim().slice(0,120);
  const description=String(form.get("description")||"").trim().slice(0,2000);
  const cents=toCents(form.get("amount"));
  const photoPath=String(form.get("photoPath")||"");
  if(!teen||teen.role!=="teen")return Response.json({error:"Unknown teen"},{status:400});
  if(!title||!description)return Response.json({error:"Add a title and say what happened"},{status:400});
  if(!(cents>0&&cents<=100000))return Response.json({error:"Enter an amount up to $1,000"},{status:400});
  if(!photoPath||!isMemberClaimPhotoPath(photoPath,session.memberId))return Response.json({error:"Upload a valid claim photo before submitting."},{status:400});

  let savedPhoto=false;
  try {
    const blob=await readClaimPhoto(photoPath,session.memberId);
    if(!blob||blob.statusCode!==200)return Response.json({error:"The uploaded claim photo could not be found."},{status:400});
    if(blob.blob.size>MAX_CLAIM_PHOTO_BYTES)return Response.json({error:"Photo must be under 8 MB."},{status:400});
    const data=Buffer.from(await new Response(blob.stream).arrayBuffer());
    const detected=detectClaimPhoto(data);
    if(!detected||detected.mime!==blob.blob.contentType)return Response.json({error:"Use a valid JPEG, PNG or WebP photo. SVG and other file types are not accepted."},{status:400});
    const ai=await assessClaim({claim:{title,description,amount_cents:cents},teenName:teen.name,teenAge:teen.age,rules:await getRules(),
      jarBalance:(await balances(teen.id)).jar,previousClaims:(await getClaims(teen.id)).map(c=>({title:c.title,status:c.status,created_at:c.created_at})),
      photo:{data,mime:detected.mime}});
    const claim=await insertClaim({member_id:teen.id,title,description,amount_cents:cents,photo_file:photoPath,photo_mime:detected.mime,ai});
    savedPhoto=true;
    return Response.json({...claim,ai});
  } catch(e) {
    return Response.json({error:`Claim submission failed: ${(e as Error).message}`},{status:502});
  } finally {
    if(!savedPhoto){try{await deleteClaimPhoto(photoPath,session.memberId);}catch{/* orphaned private uploads can be cleaned up operationally */}}
  }
}
