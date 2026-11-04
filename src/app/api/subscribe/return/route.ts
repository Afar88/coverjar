import { updateSubscriptionStatus } from "@/lib/db";
import { getSubscriptionStatus } from "@/lib/paypal";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const subId = url.searchParams.get("subscription_id") || url.searchParams.get("id") || "";
  if (!subId) return Response.redirect(`${url.origin}/?subscribe=error`);
  try {
    const status = await getSubscriptionStatus(subId);
    updateSubscriptionStatus(subId, status);
    // The approval redirect is not proof that a billing cycle was paid.
    // Actual allowance credits are issued only from verified PAYMENT.SALE.COMPLETED webhooks.
    return Response.redirect(`${url.origin}/?subscribe=${status.toLowerCase()}`);
  } catch {
    return Response.redirect(`${url.origin}/?subscribe=error`);
  }
}
