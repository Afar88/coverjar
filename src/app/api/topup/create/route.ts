import { getDb, getMember, getStreakStatus, reserveStreakBonus } from "@/lib/db";
import { toCents } from "@/lib/money";
import { createOrder } from "@/lib/paypal";
import { requireRole } from "@/lib/auth";

export async function POST(req: Request) {
  const session = requireRole(req, "parent");
  if (!session) return Response.json({ error: "Parent access required" }, { status: 403 });
  const { memberId, amount, method } = await req.json();
  const teen = getMember(memberId);
  let cents = toCents(amount);
  if (!teen || teen.role !== "teen") return Response.json({ error: "Unknown teen" }, { status: 400 });
  if (method === "streak_bonus") {
    const streak = getStreakStatus(teen.id);
    if (!streak.eligible || !streak.endWeek) return Response.json({ error: "This teen has no unmatched four-week saving streak yet." }, { status: 409 });
    cents = streak.bonusCents;
    if (!(cents >= 100 && cents <= 50000)) return Response.json({ error: "The calculated match must be between $1 and $500. Check the family match percentage." }, { status: 400 });
  } else if (!(cents >= 100 && cents <= 50000)) return Response.json({ error: "Amount must be between $1 and $500" }, { status: 400 });

  const origin = new URL(req.url).origin;
  try {
    const order = await createOrder({
      cents,
      description: method === "streak_bonus" ? `Paraguas saving streak match for ${teen.name}` : `Paraguas allowance for ${teen.name}`,
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
    const d = getDb();
    const save = d.transaction(() => {
      d.prepare("INSERT INTO payments (order_id, member_id, amount_cents, method, status) VALUES (?, ?, ?, ?, ?)")
        .run(order.id, teen.id, cents, method === "crypto" ? "crypto" : method === "streak_bonus" ? "streak_bonus" : "paypal", "CREATED");
      if (method === "streak_bonus") {
        const streak = getStreakStatus(teen.id);
        if (!streak.eligible || !streak.endWeek || streak.bonusCents !== cents) throw new Error("Saving streak changed before the match could be reserved.");
        reserveStreakBonus(teen.id, streak.endWeek, order.id, cents);
      }
    });
    save();
    return Response.json(order);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
