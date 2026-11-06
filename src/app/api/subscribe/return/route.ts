import { recordMockSubscriptionPayment, updateSubscriptionStatus } from "@/lib/db";
import { getSubscriptionStatus } from "@/lib/paypal";
import { requireRole } from "@/lib/auth";

export async function GET(req:Request) {
  const session=requireRole(req,"parent");
  if(!session)return Response.redirect(new URL("/?subscribe=error",req.url));
  const url=new URL(req.url); const subId=url.searchParams.get("subscription_id")||url.searchParams.get("id")||"";
  if(!subId)return Response.redirect(`${url.origin}/?subscribe=error`);
  try {
    const status=await getSubscriptionStatus(subId);
    await updateSubscriptionStatus(subId,status,session.familyId);
    if(subId.startsWith("MOCK-")&&(status==="ACTIVE"||status==="APPROVED"))await recordMockSubscriptionPayment(subId,session.familyId);
    return Response.redirect(`${url.origin}/?subscribe=${status.toLowerCase()}`);
  } catch{return Response.redirect(`${url.origin}/?subscribe=error`);}
}
