import { getDb, getMember } from "@/lib/db";
import { toCents } from "@/lib/money";
import { createOrder } from "@/lib/paypal";
import { requireRole } from "@/lib/auth";

export async function POST(req: Request) {
  const session = requireRole(req, "parent");
  if (!session) return Response.json({ error: "Parent access required" }, { status: 403 });
  const { memberId, amount, method } = await req.json();
  const teen = getMember(memberId);
  const cents = toCents(amount);
  if (!teen || teen.role !== "teen") return Response.json({ error: "Unknown teen" }, { status: 400 });
  if (!(cents >= 100 && cents <= 50000)) return Response.json({ error: "Amount must be between $1 and $500" }, { status: 400 });

  const origin = new URL(req.url).origin;
  try {
    const order = await createOrder({
      cents,
      description: `Paraguas allowance for ${teen.name}`,
      referenceId: teen.id,
      crypto:
        method === "crypto"
          ? {
              givenName: "Ada",
              surname: "Parent",
              returnUrl: `${origin}/api/topup/crypto-return`,
              cancelUrl: `${origin}/?topup=cancelled`,
            }
          : undefined,
    });
    getDb()
      .prepare("INSERT INTO payments (order_id, member_id, amount_cents, method, status) VALUES (?, ?, ?, ?, ?)")
      .run(order.id, teen.id, cents, method === "crypto" ? "crypto" : "paypal", "CREATED");
    return Response.json(order);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
