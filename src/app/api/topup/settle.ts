import { creditAllowance, getMember, withTransaction } from "@/lib/db";
import { queryRows } from "@/lib/db";

type Payment={order_id:string;member_id:string;amount_cents:number;method:string;status:string};
type CapturedAmount={value:string;currencyCode:string}|null;

/** Atomically settle a verified PayPal order and credit the correct ledger buckets once. */
export async function settlePayment(orderId:string,captureId:string,amount:CapturedAmount=null) {
  return withTransaction(async client=>{
    const [p]=await queryRows<Payment>("SELECT * FROM payments WHERE order_id=$1 FOR UPDATE",[orderId],client);
    if(!p)throw new Error("Unknown order");
    if(p.status==="COMPLETED")return {alreadySettled:true,payment:p};
    if(!orderId.startsWith("MOCK-")){
      const value=amount?.value; const currency=amount?.currencyCode;
      const valid=typeof value==="string"&&/^(0|[1-9]\\d*)\\.\\d{2}$/.test(value);
      const captured=valid?Number(value!.replace(".","")):NaN;
      if(currency!=="USD"||!Number.isSafeInteger(captured)||captured!==p.amount_cents)throw new Error("Captured amount or currency does not match the original order");
    }
    const teen=await getMember(p.member_id,client);
    if(!teen||teen.role!=="teen")throw new Error("Payment is linked to an invalid teen account");
    const updated=await queryRows("UPDATE payments SET status='COMPLETED' WHERE order_id=$1 AND status='CREATED' RETURNING order_id",[orderId],client);
    if(!updated.length)throw new Error("Payment is not eligible for settlement");
    if(p.method==="streak_bonus"){
      const award=await queryRows("UPDATE streak_bonus_awards SET status='COMPLETED' WHERE order_id=$1 AND status='PENDING' RETURNING order_id",[orderId],client);
      if(!award.length)throw new Error("Saving streak match reservation is missing or already settled");
      await client.query("INSERT INTO ledger(member_id,bucket,amount_cents,kind,memo,paypal_ref) VALUES($1,'jar',$2,'bonus','Parent-funded saving streak match',$3)",[teen.id,p.amount_cents,captureId]);
      return {alreadySettled:false,payment:{...p,status:"COMPLETED"},split:{spend:0,jar:p.amount_cents}};
    }
    const label=p.method==="crypto"?"Allowance top-up (paid with crypto/PYUSD)":"Allowance top-up via PayPal";
    const split=await creditAllowance(teen.id,p.amount_cents,captureId,label,client);
    return {alreadySettled:false,payment:{...p,status:"COMPLETED"},split};
  });
}
