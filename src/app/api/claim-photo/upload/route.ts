import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireRole } from "@/lib/auth";
import { MAX_CLAIM_PHOTO_BYTES, isMemberClaimPhotoPath } from "@/lib/storage";

const ALLOWED=["image/jpeg","image/png","image/webp"];

export async function POST(request:Request) {
  let body:HandleUploadBody;
  try{body=await request.json() as HandleUploadBody;}catch{return Response.json({error:"Invalid upload request"},{status:400});}
  try {
    const response=await handleUpload({
      body,request,
      onBeforeGenerateToken:async(pathname,clientPayload)=>{
        const session=requireRole(request,"teen");
        if(!session)throw new Error("Teen access required");
        if(clientPayload!==JSON.stringify({memberId:session.memberId,familyId:session.familyId})||!isMemberClaimPhotoPath(pathname,session.memberId,session.familyId))throw new Error("Upload path is not authorized for this teen account");
        return {allowedContentTypes:ALLOWED,maximumSizeInBytes:MAX_CLAIM_PHOTO_BYTES,addRandomSuffix:false,tokenPayload:JSON.stringify({memberId:session.memberId,familyId:session.familyId})};
      },
      onUploadCompleted:async({blob,tokenPayload})=>{
        const payload=JSON.parse(tokenPayload||"{}") as {memberId?:string;familyId?:string};
        if(!payload.memberId||!payload.familyId||!isMemberClaimPhotoPath(blob.pathname,payload.memberId,payload.familyId))throw new Error("Completed upload ownership could not be verified");
      },
    });
    return Response.json(response);
  }catch(error){return Response.json({error:(error as Error).message||"Upload authorization failed"},{status:400});}
}
