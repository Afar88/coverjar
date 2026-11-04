import { getMember, saveSubscription } from "@/lib/db";
import { createAllowanceSubscription } from "@/lib/paypal";

export async function POST(req: Request) {
  const { memberId } = await req.json();
  const teen = getMember(memberId);
  if (!teen || teen.role !== "teen") return Response.json({ error: "Unknown teen" }, { status: 400 });
  const origin = new URL(req.url).origin;
  try {
    const sub = await createAllowanceSubscription({
      teenName: teen.name,
      cents: teen.allowance_cents,
      returnUrl: `${origin}/api/subscribe/return?member=${teen.id}`,
      cancelUrl: `${origin}/?subscribe=cancelled`,
    });
    saveSubscription(sub.id, teen.id, teen.allowance_cents);
    return Response.json(sub);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
