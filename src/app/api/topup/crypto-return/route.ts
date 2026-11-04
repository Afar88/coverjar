import { getOrderStatus } from "@/lib/paypal";
import { settlePayment } from "../settle";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const orderId = url.searchParams.get("token") || "";
  try {
    const o = await getOrderStatus(orderId);
    if (o.status === "COMPLETED") settlePayment(orderId, o.captureId);
    return Response.redirect(`${url.origin}/?topup=${o.status === "COMPLETED" ? "crypto-ok" : "pending"}`);
  } catch {
    return Response.redirect(`${url.origin}/?topup=error`);
  }
}
