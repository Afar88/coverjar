import { creditAllowance, getDb, getMember } from "@/lib/db";
import { getSubscriptionStatus } from "@/lib/paypal";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const subId = url.searchParams.get("subscription_id") || url.searchParams.get("id") || "";
  const teen = getMember(url.searchParams.get("member") || "");
  if (!teen || !subId) return Response.redirect(`${url.origin}/?subscribe=error`);
  try {
    const status = await getSubscriptionStatus(subId);
    if (status === "ACTIVE" || status === "APPROVED") {
      const d = getDb();
      const inserted = d
        .prepare("INSERT OR IGNORE INTO payments (order_id, member_id, amount_cents, method, status) VALUES (?, ?, ?, 'subscription', 'COMPLETED')")
        .run(subId, teen.id, teen.allowance_cents);
      if (inserted.changes) creditAllowance(teen.id, teen.allowance_cents, subId, "Weekly allowance (PayPal subscription, week 1)");
    }
    return Response.redirect(`${url.origin}/?subscribe=${status.toLowerCase()}`);
  } catch {
    return Response.redirect(`${url.origin}/?subscribe=error`);
  }
}
