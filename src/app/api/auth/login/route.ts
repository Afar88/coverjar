import { createSession, sessionCookie, verifyLogin, verifyFamilyLogin } from "@/lib/auth";
import { consumeRateLimit } from "@/lib/db";

const LOGIN_LIMIT=8;
const LOGIN_WINDOW_MS=15*60*1000;

export async function POST(req:Request) {
  let body:{role?:string;memberId?:string;pin?:string;password?:string;familyCode?:string};
  try{body=await req.json();}catch{return Response.json({error:"Invalid request"},{status:400});}
  const role=body.role;
  if(role!=="parent"&&role!=="teen")return Response.json({error:"Incorrect passcode or account"},{status:401});
  const familyCode=String(body.familyCode||"").trim().toUpperCase();
  if(familyCode){
    const credential=role==="parent"?String(body.password||""):String(body.pin||"");
    const rate=await consumeRateLimit(`family-login:${familyCode}:${role}`,LOGIN_LIMIT,LOGIN_WINDOW_MS);
    if(!rate.allowed)return Response.json({error:"Too many login attempts. Please wait before trying again."},{status:429,headers:{"Retry-After":String(rate.retryAfterSeconds),"Cache-Control":"no-store"}});
    const identity=await verifyFamilyLogin(role,familyCode,credential,body.memberId);
    if(!identity)return Response.json({error:"Incorrect family code or credentials"},{status:401,headers:{"Cache-Control":"no-store"}});
    const token=createSession(role,identity.memberId,identity.familyId);
    return Response.json({role,...identity},{headers:{"Set-Cookie":sessionCookie(token),"Cache-Control":"no-store"}});
  }
  // Backward-compatible demo login only; new accounts must use a family code.
  const memberId=role==="parent"?"parent":String(body.memberId||"");
  if(!/^[a-zA-Z0-9_-]{1,64}$/.test(memberId))return Response.json({error:"Incorrect passcode or account"},{status:401});
  const rate=await consumeRateLimit(`login:${role}:${memberId}`,LOGIN_LIMIT,LOGIN_WINDOW_MS);
  if(!rate.allowed)return Response.json({error:"Too many login attempts. Please wait before trying again."},{status:429,headers:{"Retry-After":String(rate.retryAfterSeconds),"Cache-Control":"no-store"}});
  if(!await verifyLogin(role,memberId,String(body.pin||"")))return Response.json({error:"Incorrect passcode or account"},{status:401});
  const token=createSession(role,memberId,"legacy-family");
  return Response.json({role,memberId,familyId:"legacy-family"},{headers:{"Set-Cookie":sessionCookie(token),"Cache-Control":"no-store"}});
}
