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
  const amountText = typeof body.amount === "number" ? String(body.amount) :
    typeof body.amount === "string" ? body.amount.trim() : "";
  if (!/^(?:\d+)(?:\.\d{1,2})?$/.test(amountText)) {
    return Response.json({ error: "Enter a valid amount with up to two decimal places." }, { status: 400 });
  }
  const cents = toCents(amountText);
  if (!memberId || !Number.isSafeInteger(cents) || cents < 100 || cents > 50000) {
    return Response.json({ error: "Weekly allowance must be between $1 and $500." }, { status: 400 });
  }

  const member = await getMember(memberId);
  if (!member || member.role !== "teen") {
    return Response.json({ error: "Unknown teen profile." }, { status: 404 });
  }

  const updated = await setAllowance(memberId, cents);
  if (updated !== 1) {
    return Response.json({ error: "The allowance could not be saved. Refresh and try again." }, { status: 409 });
  }
  return Response.json({
    success: true,
    memberId,
    allowance_cents: cents,
  }, { headers: { "Cache-Control": "no-store" } });
}
