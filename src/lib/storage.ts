import { del, get } from "@vercel/blob";

export const MAX_CLAIM_PHOTO_BYTES=8*1024*1024;
export type ClaimPhotoMime="image/jpeg"|"image/png"|"image/webp";

export function detectClaimPhoto(data:Buffer):{mime:ClaimPhotoMime;extension:".jpg"|".png"|".webp"}|null {
  if(data.length>=3&&data[0]===0xff&&data[1]===0xd8&&data[2]===0xff)return {mime:"image/jpeg",extension:".jpg"};
  if(data.length>=8&&data.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))return {mime:"image/png",extension:".png"};
  if(data.length>=12&&data.toString("ascii",0,4)==="RIFF"&&data.toString("ascii",8,12)==="WEBP")return {mime:"image/webp",extension:".webp"};
  return null;
}

export function isMemberClaimPhotoPath(pathname:string,memberId:string) {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(memberId) && pathname.startsWith(`claims/${memberId}/`) &&
    /^claims\/[a-zA-Z0-9_-]{1,64}\/[a-f0-9-]+\.(jpg|png|webp)$/.test(pathname);
}

/** Read a private Blob by an authenticated member-scoped pathname, never a caller-supplied URL. */
export async function readClaimPhoto(pathname:string,memberId:string) {
  if(!isMemberClaimPhotoPath(pathname,memberId))return null;
  return get(pathname,{access:"private"});
}

export async function deleteClaimPhoto(pathname:string,memberId:string) {
  if(!isMemberClaimPhotoPath(pathname,memberId))return;
  await del(pathname);
}
