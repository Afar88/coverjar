import { captureOrder } from "@/lib/paypal";
import { settlePayment } from "../settle";

export async function POST(req: Request) {
  const { orderId } = await req.json();
  try {
    const cap = await captureOrder(orderId);
    if (cap.status !== "COMPLETED") return Response.json({ error: `Payment status: ${cap.status}` }, { status: 402 });
    return Response.json(settlePayment(orderId, cap.captureId));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
