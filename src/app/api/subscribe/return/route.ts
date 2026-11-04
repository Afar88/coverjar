import { recordMockSubscriptionPayment, updateSubscriptionStatus } from "@/lib/db";
import { getSubscriptionStatus } from "@/lib/paypal";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const subId = url.searchParams.get("subscription_id") || url.searchParams.get("id") || "";
  if (!subId) return Response.redirect(`${url.origin}/?subscribe=error`);
  try {
    const status = await getSubscriptionStatus(subId);
    updateSubscriptionStatus(subId, status);
    // Demo mode has no PayPal webhook, so simulate its first payment exactly once.
    // Real subscriptions are credited only by verified PAYMENT.SALE.COMPLETED webhooks.
    if (subId.startsWith("MOCK-") && (status === "ACTIVE" || status === "APPROVED")) {
      recordMockSubscriptionPayment(subId);
    }
    return Response.redirect(`${url.origin}/?subscribe=${status.toLowerCase()}`);
  } catch {
    return Response.redirect(`${url.origin}/?subscribe=error`);
  }
}
