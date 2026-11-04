import { cancelStreakBonus } from "@/lib/db";
import { requireRole } from "@/lib/auth";

export async function POST(req: Request) {
  if (!requireRole(req, "parent")) return Response.json({ error: "Parent access required" }, { status: 403 });
  let body: { orderId?: string };
  try { body = await req.json(); } catch { return Response.json({ error: "Invalid request body" }, { status: 400 }); }
  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  if (!orderId || orderId.length > 128) return Response.json({ error: "A valid orderId is required" }, { status: 400 });
  return Response.json({ cancelled: cancelStreakBonus(orderId) });
}
