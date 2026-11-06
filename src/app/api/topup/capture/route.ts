import { queryRows } from "@/lib/db";
import { captureOrder } from "@/lib/paypal";
import { settlePayment } from "../settle";
import { requireRole } from "@/lib/auth";

type StoredPayment={order_id:string;member_id:string;status:string};
export async function POST(req:Request) {
  const session=requireRole(req,"parent");
  if(!session)return Response.json({error:"Parent access required"},{status:403});
  let body:{orderId?:string};try{body=await req.json();}catch{return Response.json({error:"Invalid request body"},{status:400});}
  const orderId=typeof body.orderId==="string"?body.orderId.trim():"";
  if(!orderId||orderId.length>128)return Response.json({error:"A valid orderId is required"},{status:400});
  const [payment]=await queryRows<StoredPayment>("SELECT p.order_id,p.member_id,p.status FROM payments p JOIN members m ON m.id=p.member_id WHERE p.order_id=$1 AND p.family_id=$2 AND m.family_id=p.family_id AND m.role='teen'",[orderId,session.familyId]);
  if(!payment)return Response.json({error:"Unknown payment order"},{status:404});
  if(payment.status==="COMPLETED")return Response.json({alreadySettled:true,payment});
  try {
    const cap=await captureOrder(orderId);
    if(cap.status!=="COMPLETED")return Response.json({error:`Payment status: ${cap.status}`},{status:402});
    return Response.json(await settlePayment(orderId,cap.captureId,cap.amount,session.familyId));
  } catch(e){return Response.json({error:(e as Error).message},{status:502});}
}
