import { setAllowance, updateRules, type Rules } from "@/lib/db";
import { toCents } from "@/lib/money";
import { requireRole } from "@/lib/auth";

export async function POST(req:Request) {
  const session=requireRole(req,"parent");
  if(!session)return Response.json({error:"Parent access required"},{status:403});
  let b:Record<string,unknown>;
  try{b=await req.json();}catch{return Response.json({error:"Invalid request body"},{status:400});}
  const patch:Partial<Rules>={};
  if(b.streak_bonus_percent!==undefined){const p=Math.round(Number(b.streak_bonus_percent));if(!(p>=0&&p<=100))return Response.json({error:"Streak match % must be 0-100"},{status:400});patch.streak_bonus_percent=p;}
  if(b.jar_percent!==undefined){const p=Math.round(Number(b.jar_percent));if(!(p>=0&&p<=100))return Response.json({error:"Jar % must be 0-100"},{status:400});patch.jar_percent=p;}
  for(const k of ["deductible","max_payout"] as const){
    if(b[k]!==undefined){
      const cents=toCents(b[k]);
      if(!(cents>=0))return Response.json({error:`Invalid ${k}`},{status:400});
      if(k==="deductible")patch.deductible_cents=cents;else patch.max_payout_cents=cents;
    }
  }
  if(Array.isArray(b.covered))patch.covered=b.covered.map(String).filter(Boolean);
  if(Array.isArray(b.excluded))patch.excluded=b.excluded.map(String).filter(Boolean);
  if(typeof b.repair_shop_email==="string"){
    const email=b.repair_shop_email.trim();
    if(email.length>254 || (email!=="" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
      return Response.json({error:"Enter a valid repair-shop PayPal email, or leave it blank until one is available."},{status:400});
    patch.repair_shop_email=email;
  }
  if(b.allowances&&typeof b.allowances==="object"&&!Array.isArray(b.allowances)){
    for(const [id,value] of Object.entries(b.allowances)){const cents=toCents(value);if(cents>=0)await setAllowance(id,cents,session.familyId);}
  }
  return Response.json(await updateRules(patch,session.familyId));
}
