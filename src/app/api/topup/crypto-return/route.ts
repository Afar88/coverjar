import { getOrderStatus } from "@/lib/paypal";
import { settlePayment } from "../settle";
import { requireRole } from "@/lib/auth";

export async function GET(req:Request) {
  const session=requireRole(req,"parent");
  if(!session)return Response.redirect(new URL("/?topup=error",req.url));
  const url=new URL(req.url); const orderId=url.searchParams.get("token")||"";
  try {
    const order=await getOrderStatus(orderId);
    if(order.status==="COMPLETED")await settlePayment(orderId,order.captureId,order.amount,session.familyId);
    return Response.redirect(`${url.origin}/?topup=${order.status==="COMPLETED"?"crypto-ok":"pending"}`);
  } catch{return Response.redirect(`${url.origin}/?topup=error`);}
}
