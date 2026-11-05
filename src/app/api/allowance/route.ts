import { getMember, setAllowance } from "@/lib/db";
import { toCents } from "@/lib/money";
import { requireRole } from "@/lib/auth";

export async function POST(req: Request) {
  if (!requireRole(req, "parent")) {
    return Response.json({ error: "Parent access required" }, { status: 403 });
  }

  let body: { memberId?: unknown; amount?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const memberId = typeof body.memberId === "string" ? body.memberId.trim() : "";
  const cents = toCents(body.amount);
  if (!memberId || !Number.isSafeInteger(cents) || cents < 100 || cents > 50000) {
    return Response.json({ error: "Weekly allowance must be between $1 and $500." }, { status: 400 });
  }

  const member = await getMember(memberId);
  if (!member || member.role !== "teen") {
    return Response.json({ error: "Unknown teen profile." }, { status: 404 });
  }

  await setAllowance(memberId, cents);
  return Response.json({
    success: true,
    memberId,
    allowance_cents: cents,
  }, { headers: { "Cache-Control": "no-store" } });
}
