import { getDb } from "@/lib/db";
import { captureOrder } from "@/lib/paypal";
import { settlePayment } from "../settle";

type StoredPayment = { order_id: string; status: string };

export async function POST(req: Request) {
  let body: { orderId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  if (!orderId || orderId.length > 128) return Response.json({ error: "A valid orderId is required" }, { status: 400 });

  const payment = getDb()
    .prepare("SELECT order_id, status FROM payments WHERE order_id = ?")
    .get(orderId) as StoredPayment | undefined;
  if (!payment) return Response.json({ error: "Unknown payment order" }, { status: 404 });
  if (payment.status === "COMPLETED") return Response.json({ alreadySettled: true, payment });

  try {
    const cap = await captureOrder(orderId);
    if (cap.status !== "COMPLETED") return Response.json({ error: `Payment status: ${cap.status}` }, { status: 402 });
    return Response.json(settlePayment(orderId, cap.captureId, cap.amount));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
