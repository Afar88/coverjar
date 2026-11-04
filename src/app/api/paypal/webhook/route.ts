import { recordSubscriptionPayment, updateSubscriptionStatus } from "@/lib/db";
import { verifyPaypalWebhook } from "@/lib/paypal";

type PaypalEvent = {
  id?: string;
  event_type?: string;
  resource?: {
    id?: string;
    status?: string;
    billing_agreement_id?: string;
    amount?: { total?: string; value?: string; currency?: string; currency_code?: string };
    supplementary_data?: { related_ids?: { billing_agreement_id?: string } };
  };
};

function toCents(value: string) {
  if (!/^\\d+(\\.\\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export async function POST(req: Request) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return Response.json({ error: "Webhook is not configured" }, { status: 503 });

  let event: PaypalEvent;
  try {
    event = (await req.json()) as PaypalEvent;
  } catch {
    return Response.json({ error: "Invalid webhook payload" }, { status: 400 });
  }

  try {
    const verified = await verifyPaypalWebhook(req.headers, event);
    if (!verified) return Response.json({ error: "Invalid PayPal signature" }, { status: 401 });
    if (!event.id || !event.event_type) return Response.json({ error: "Missing PayPal event identity" }, { status: 400 });

    const resource = event.resource || {};
    if (
      event.event_type === "BILLING.SUBSCRIPTION.ACTIVATED" ||
      event.event_type === "BILLING.SUBSCRIPTION.CANCELLED" ||
      event.event_type === "BILLING.SUBSCRIPTION.SUSPENDED" ||
      event.event_type === "BILLING.SUBSCRIPTION.EXPIRED"
    ) {
      if (resource.id) updateSubscriptionStatus(resource.id, resource.status || event.event_type.split(".").pop() || "UNKNOWN");
      return Response.json({ received: true });
    }

    if (event.event_type === "PAYMENT.SALE.COMPLETED") {
      const subscriptionId =
        resource.billing_agreement_id ||
        resource.supplementary_data?.related_ids?.billing_agreement_id;
      const saleId = resource.id;
      const amount = resource.amount?.total || resource.amount?.value;
      const currency = resource.amount?.currency || resource.amount?.currency_code;
      const amountCents = amount ? toCents(amount) : null;
      if (!subscriptionId || !saleId || amountCents === null || currency !== "USD") {
        return Response.json({ error: "Incomplete subscription payment details" }, { status: 400 });
      }
      const result = recordSubscriptionPayment({
        eventId: event.id,
        eventType: event.event_type,
        subscriptionId,
        saleId,
        amountCents,
      });
      return Response.json({ received: true, ...result });
    }

    return Response.json({ received: true, ignored: true });
  } catch (error) {
    // A non-2xx response asks PayPal to retry; do not acknowledge an event we failed to process.
    return Response.json({ error: (error as Error).message || "Webhook processing failed" }, { status: 500 });
  }
}
