import { addLedger, balances, getMember } from "@/lib/db";
import { toCents } from "@/lib/money";

export async function POST(req: Request) {
  const { memberId, amount, memo } = await req.json();
  const teen = getMember(memberId);
  const cents = toCents(amount);
  if (!teen || teen.role !== "teen") return Response.json({ error: "Unknown teen" }, { status: 400 });
  if (!(cents > 0)) return Response.json({ error: "Enter an amount" }, { status: 400 });
  if (cents > balances(teen.id).spend) return Response.json({ error: "Not enough spending money" }, { status: 400 });
  addLedger({ member_id: teen.id, bucket: "spend", amount_cents: -cents, kind: "purchase", memo: String(memo || "Purchase").slice(0, 80), paypal_ref: null });
  return Response.json(balances(teen.id));
}
