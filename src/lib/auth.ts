import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { getFamilyByCode, getFamilyMember, getMember, queryRows } from "@/lib/db";

const scryptAsync=(password:string,salt:Buffer,keylen:number,options:{N:number;r:number;p:number;maxmem:number})=>new Promise<Buffer>((resolve,reject)=>{
  scryptCallback(password,salt,keylen,options,(error,derived)=>error?reject(error):resolve(derived as Buffer));
});

export type Session = { role: "parent" | "teen"; memberId: string; familyId: string; expiresAt: number };
const COOKIE = "paraguas_session";
const MAX_AGE = 60 * 60 * 12;

function secret() {
  const value = process.env.PARAGUAS_SESSION_SECRET;
  if (value && value.length >= 32) return value;
  if (process.env.NODE_ENV !== "production") return "local-development-only-paraguas-session-secret";
  throw new Error("PARAGUAS_SESSION_SECRET must be configured with at least 32 characters");
}
function sign(value: string) { return createHmac("sha256", secret()).update(value).digest("base64url"); }
function safeEqual(a: string, b: string) {
  const left=Buffer.from(a); const right=Buffer.from(b);
  return left.length===right.length && timingSafeEqual(left,right);
}
export function createSession(role:Session["role"],memberId:string,familyId="legacy-family") {
  const payload:Session={role,memberId,familyId,expiresAt:Date.now()+MAX_AGE*1000};
  const encoded=Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}
export function readSession(req:Request):Session|null {
  try {
    const cookie=req.headers.get("cookie")||"";
    const token=cookie.split(";").map(v=>v.trim()).find(v=>v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1);
    if(!token)return null;
    const [encoded,signature]=token.split(".");
    if(!encoded||!signature||!safeEqual(signature,sign(encoded)))return null;
    const session=JSON.parse(Buffer.from(encoded,"base64url").toString("utf8")) as Session;
    if(!["parent","teen"].includes(session.role)||!session.memberId||session.expiresAt<=Date.now())return null;
    return {...session,familyId:session.familyId||"legacy-family"};
  } catch { return null; }
}
export function requireRole(req:Request,role?:Session["role"]):Session|null {
  const session=readSession(req);
  return session&&(!role||session.role===role)?session:null;
}
export function sessionCookie(token:string) {
  const secure=process.env.NODE_ENV==="production"?"; Secure":"";
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}${secure}`;
}
export function clearSessionCookie() {
  const secure=process.env.NODE_ENV==="production"?"; Secure":"";
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}
export async function verifyLogin(role:Session["role"],memberId:string,pin:string) {
  const member=await getMember(memberId);
  if(!member||member.role!==role||!/^\d{4,12}$/.test(pin))return false;
  const configured=role==="parent"?process.env.PARAGUAS_PARENT_PIN:process.env.PARAGUAS_TEEN_PIN;
  const expected=configured||(process.env.NODE_ENV!=="production"?(role==="parent"?"2468":"1357"):"");
  return Boolean(expected)&&safeEqual(pin,expected);
}

const HASH_N=16384;
export async function hashSecret(secretValue:string) {
  const salt=randomBytes(16);
  const derived=await scryptAsync(secretValue,salt,64,{N:HASH_N,r:8,p:1,maxmem:64*1024*1024});
  return `scrypt$${HASH_N}$8$1$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}
export async function verifySecret(secretValue:string,encoded:string|null|undefined) {
  try {
    if(!encoded)return false;
    const [scheme,n,r,p,saltText,keyText]=encoded.split("$");
    if(scheme!=="scrypt"||Number(n)!==HASH_N||Number(r)!==8||Number(p)!==1||!saltText||!keyText)return false;
    const expected=Buffer.from(keyText,"base64url");
    const actual=await scryptAsync(secretValue,Buffer.from(saltText,"base64url"),expected.length,{N:HASH_N,r:8,p:1,maxmem:64*1024*1024});
    return expected.length===actual.length&&timingSafeEqual(expected,actual);
  } catch { return false; }
}

export async function verifyFamilyLogin(role:Session["role"],familyCode:string,credential:string,memberId?:string) {
  const family=await getFamilyByCode(familyCode);
  if(!family)return null;
  if(role==="parent") {
    if(!await verifySecret(credential,family.password_hash))return null;
    return {familyId:family.id,memberId:`parent_${family.id}`};
  }
  if(!memberId||!/^\d{4,12}$/.test(credential))return null;
  const member=await getFamilyMember(memberId,family.id);
  if(!member||member.role!=="teen")return null;
  const [row]=await queryRows<{pin_hash:string|null}>("SELECT pin_hash FROM members WHERE id=$1 AND family_id=$2",[memberId,family.id]);
  if(!await verifySecret(credential,row?.pin_hash))return null;
  return {familyId:family.id,memberId};
}
