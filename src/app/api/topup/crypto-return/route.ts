import { getOrderStatus } from "@/lib/paypal";
import { settlePayment } from "../settle";
import { requireRole } from "@/lib/auth";

export async function GET(req: Request) {
  if (!requireRole(req, "parent")) return Response.redirect(new URL("/?topup=error", req.url));
  const url = new URL(req.url);
  const orderId = url.searchParams.get("token") || "";
  try {
    const o = await getOrderStatus(orderId);
    if (o.status === "COMPLETED") settlePayment(orderId, o.captureId, o.amount);
    return Response.redirect(`${url.origin}/?topup=${o.status === "COMPLETED" ? "crypto-ok" : "pending"}`);
  } catch {
    return Response.redirect(`${url.origin}/?topup=error`);
  }
}
