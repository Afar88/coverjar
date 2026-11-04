import { balances, consumeRateLimit, getClaims, getMember, getRules, insertClaim } from "@/lib/db";
import { toCents } from "@/lib/money";
import { assessClaim } from "@/lib/gemini";
import { deleteClaimPhoto, saveClaimPhoto } from "@/lib/storage";
import { requireRole } from "@/lib/auth";

const MAX_PHOTO_BYTES=8*1024*1024;
function detectPhoto(data:Buffer):{mime:"image/jpeg"|"image/png"|"image/webp";extension:".jpg"|".png"|".webp"}|null {
  if(data.length>=3&&data[0]===0xff&&data[1]===0xd8&&data[2]===0xff)return {mime:"image/jpeg",extension:".jpg"};
  if(data.length>=8&&data.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))return {mime:"image/png",extension:".png"};
  if(data.length>=12&&data.toString("ascii",0,4)==="RIFF"&&data.toString("ascii",8,12)==="WEBP")return {mime:"image/webp",extension:".webp"};
  return null;
}
export async function POST(req:Request) {
  const session=requireRole(req,"teen");
  if(!session)return Response.json({error:"Teen access required"},{status:403});
  const rate=await consumeRateLimit(`claim-submit:${session.memberId}`,5,60*60*1000);
  if(!rate.allowed)return Response.json({error:"Too many claim submissions. Please try again later."},{status:429,headers:{"Retry-After":String(rate.retryAfterSeconds),"Cache-Control":"no-store"}});
  const contentLength=Number(req.headers.get("content-length")||0);
  if(contentLength>MAX_PHOTO_BYTES+128*1024)return Response.json({error:"Claim upload is too large. Keep the photo under 8 MB."},{status:413});
  let form:FormData;
  try{form=await req.formData();}catch{return Response.json({error:"Invalid claim form or photo upload"},{status:400});}
  const teen=await getMember(session.memberId);
  const title=String(form.get("title")||"").trim().slice(0,120);
  const description=String(form.get("description")||"").trim().slice(0,2000);
  const cents=toCents(form.get("amount")); const photo=form.get("photo");
  if(!teen||teen.role!=="teen")return Response.json({error:"Unknown teen"},{status:400});
  if(!title||!description)return Response.json({error:"Add a title and say what happened"},{status:400});
  if(!(cents>0&&cents<=100000))return Response.json({error:"Enter an amount up to $1,000"},{status:400});
  if(!(photo instanceof File)||photo.size===0)return Response.json({error:"Upload a clear photo of the damage to submit a claim"},{status:400});
  if(photo.size>MAX_PHOTO_BYTES)return Response.json({error:"Photo must be under 8 MB"},{status:400});
  let data:Buffer;
  try{data=Buffer.from(await photo.arrayBuffer());}catch{return Response.json({error:"The photo could not be read. Please try another image."},{status:400});}
  const detected=detectPhoto(data);
  if(!detected||photo.type!==detected.mime)return Response.json({error:"Use a valid JPEG, PNG or WebP photo. SVG and other file types are not accepted."},{status:400});
  let photoPath:string|undefined;
  try {
    const stored=await saveClaimPhoto(data,detected.mime,detected.extension); photoPath=stored.pathname;
    const ai=await assessClaim({claim:{title,description,amount_cents:cents},teenName:teen.name,teenAge:teen.age,rules:await getRules(),
      jarBalance:(await balances(teen.id)).jar,previousClaims:(await getClaims(teen.id)).map(c=>({title:c.title,status:c.status,created_at:c.created_at})),
      photo:{data,mime:detected.mime,file:photoPath}});
    const claim=await insertClaim({member_id:teen.id,title,description,amount_cents:cents,photo_file:photoPath,photo_mime:detected.mime,ai});
    return Response.json({...claim,ai});
  } catch(e) {
    if(photoPath){try{await deleteClaimPhoto(photoPath);}catch{/* retain original error; orphan cleanup is operational */}}
    return Response.json({error:`Claim submission failed: ${(e as Error).message}`},{status:502});
  }
}
