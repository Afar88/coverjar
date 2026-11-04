import { addLedger, balances, getDb, getMember } from "@/lib/db";
import { toCents } from "@/lib/money";
import { requireRole } from "@/lib/auth";

export async function POST(req: Request) {
  const session = requireRole(req, "teen");
  if (!session) return Response.json({ error: "Teen access required" }, { status: 403 });
  const { amount, memo } = await req.json();
  const teen = getMember(session.memberId);
  const cents = toCents(amount);
  if (!teen || teen.role !== "teen") return Response.json({ error: "Unknown teen" }, { status: 400 });
  if (!(cents > 0)) return Response.json({ error: "Enter an amount" }, { status: 400 });

  const d = getDb();
  try {
    const result = d.transaction(() => {
      if (cents > balances(teen.id).spend) throw new Error("Not enough spending money");
      addLedger({ member_id: teen.id, bucket: "spend", amount_cents: -cents, kind: "purchase", memo: String(memo || "Purchase").slice(0, 80), paypal_ref: null });
      return balances(teen.id);
    })();
    return Response.json(result);
  } catch (e) {
    const message = (e as Error).message;
    return Response.json({ error: message }, { status: message === "Not enough spending money" ? 400 : 500 });
  }
}
