const clientId = process.env.PAYPAL_CLIENT_ID || "";
const clientSecret = process.env.PAYPAL_CLIENT_SECRET || "";
const isLive = process.env.PAYPAL_ENVIRONMENT?.toUpperCase() === "PRODUCTION";

export const paypalConfigured = Boolean(clientId && clientSecret);
export const paypalBaseUrl = isLive ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
export const publicClientId = clientId;
export const cryptoEnabled = process.env.PAYPAL_CRYPTO_ENABLED === "true";

let cachedToken: { value: string; expires: number } | null = null;

async function accessToken() {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;
  const res = await fetch(`${paypalBaseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal auth failed (${res.status}): ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: json.access_token, expires: Date.now() + json.expires_in * 1000 };
  return cachedToken.value;
}

async function paypalFetch<T>(path: string, init: { method?: string; body?: unknown; requestId?: string } = {}): Promise<T> {
  const res = await fetch(`${paypalBaseUrl}${path}`, {
    method: init.method || "GET",
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      ...(init.requestId ? { "PayPal-Request-Id": init.requestId } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const msg = json?.details?.[0]?.description || json?.message || text;
    throw new Error(`PayPal ${path} failed (${res.status}): ${msg}`);
  }
  return json as T;
}

const dollars = (cents: number) => (cents / 100).toFixed(2);
const mockId = (prefix: string) => `MOCK-${prefix}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

type Link = { rel: string; href: string };

export async function createOrder(opts: {
  cents: number;
  description: string;
  referenceId: string;
  crypto?: { givenName: string; surname: string; returnUrl: string; cancelUrl: string };
}) {
  if (!paypalConfigured) return { id: mockId("ORDER"), status: "CREATED", approveUrl: null as string | null };
  const body: Record<string, unknown> = {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: opts.referenceId,
        description: opts.description,
        amount: { currency_code: "USD", value: dollars(opts.cents) },
      },
    ],
  };
  if (opts.crypto) {
    body.processing_instruction = "ORDER_COMPLETE_ON_PAYMENT_APPROVAL";
    body.payment_source = {
      crypto: {
        country_code: "US",
        name: { given_name: opts.crypto.givenName, surname: opts.crypto.surname },
        experience_context: { locale: "en-US", return_url: opts.crypto.returnUrl, cancel_url: opts.crypto.cancelUrl },
      },
    };
  }
  const order = await paypalFetch<{ id: string; status: string; links: Link[] }>("/v2/checkout/orders", {
    method: "POST",
    body,
    requestId: crypto.randomUUID(),
  });
  const approveUrl = order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href || null;
  return { id: order.id, status: order.status, approveUrl };
}

type CaptureDetails = { id: string; status: string; amount?: { value: string; currency_code: string } };
type OrderDetails = {
  id: string;
  status: string;
  purchase_units?: { payments?: { captures?: CaptureDetails[] } }[];
};

function firstCapture(o: OrderDetails) {
  return o.purchase_units?.[0]?.payments?.captures?.[0];
}

function captureResult(o: OrderDetails) {
  const cap = firstCapture(o);
  return {
    status: cap?.status || o.status,
    captureId: cap?.id || o.id,
    amount: cap?.amount ? { value: cap.amount.value, currencyCode: cap.amount.currency_code } : null,
  };
}

export async function captureOrder(orderId: string) {
  if (!paypalConfigured || orderId.startsWith("MOCK-")) {
    return { status: "COMPLETED", captureId: mockId("CAPTURE"), amount: null };
  }
  const o = await paypalFetch<OrderDetails>(`/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    requestId: `capture-${orderId}`,
  });
  return captureResult(o);
}

export async function getOrderStatus(orderId: string) {
  if (!paypalConfigured || orderId.startsWith("MOCK-")) {
    return { status: "COMPLETED", captureId: mockId("CAPTURE"), amount: null };
  }
  const o = await paypalFetch<OrderDetails>(`/v2/checkout/orders/${orderId}`);
  return captureResult(o);
}

export async function sendPayout(opts: { email: string; cents: number; note: string; itemId: string }) {
  if (!paypalConfigured) return { batchId: mockId("PAYOUT"), status: "SUCCESS (simulated)" };
  const requestId = `payout-${opts.itemId}`;
  const body = {
    sender_batch_header: {
      sender_batch_id: `paraguas-${opts.itemId}`,
      email_subject: "Paraguas claim payout",
      email_message: opts.note,
    },
    items: [{
      recipient_type: "EMAIL",
      amount: { value: dollars(opts.cents), currency: "USD" },
      receiver: opts.email,
      note: opts.note,
      sender_item_id: opts.itemId,
    }],
  };
  let res: { batch_header: { payout_batch_id: string; batch_status: string } };
  try {
    res = await paypalFetch<{ batch_header: { payout_batch_id: string; batch_status: string } }>("/v1/payments/payouts", { method: "POST", body, requestId });
  } catch (firstError) {
    // Re-submit with the same PayPal idempotency key: if the first response was lost,
    // PayPal returns the original batch instead of creating a second payout.
    try { res = await paypalFetch<{ batch_header: { payout_batch_id: string; batch_status: string } }>("/v1/payments/payouts", { method: "POST", body, requestId }); }
    catch { throw firstError; }
  }
  const batchId = res.batch_header?.payout_batch_id;
  if (!batchId) throw new Error("PayPal did not return a payout batch reference");
  let status = res.batch_header.batch_status;
  try {
    const firstCheck = await getPayoutStatus(batchId, opts.itemId);
    status = firstCheck.batchStatus === "SUCCESS" ? firstCheck.itemStatus : firstCheck.batchStatus;
  } catch { return { batchId, status: "UNKNOWN" }; }
  for (let i = 0; i < 6 && (status === "PENDING" || status === "PROCESSING"); i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      const check = await getPayoutStatus(batchId, opts.itemId);
      status = check.batchStatus === "SUCCESS" ? check.itemStatus : check.batchStatus;
    } catch { return { batchId, status: "UNKNOWN" }; }
  }
  return { batchId, status };
}

export async function getPayoutStatus(batchId: string, itemId: string) {
  if (!paypalConfigured || batchId.startsWith("MOCK-")) return { batchStatus: "SUCCESS", itemStatus: "SUCCESS" };
  const result = await paypalFetch<{ batch_header?: { batch_status?: string }; items?: { payout_item?: { sender_item_id?: string }; transaction_status?: string }[] }>(
    `/v1/payments/payouts/${encodeURIComponent(batchId)}?page=1&page_size=100`,
  );
  const item = result.items?.find((entry) => entry.payout_item?.sender_item_id === itemId);
  return { batchStatus: result.batch_header?.batch_status || "UNKNOWN", itemStatus: item?.transaction_status || "UNKNOWN" };
}
/** Sets up a weekly PayPal subscription that funds a teen's allowance. */
export async function createAllowanceSubscription(opts: {
  teenName: string;
  cents: number;
  returnUrl: string;
  cancelUrl: string;
}) {
  if (!paypalConfigured) return { id: mockId("SUB"), approveUrl: null as string | null };
  const product = await paypalFetch<{ id: string }>("/v1/catalogs/products", {
    method: "POST",
    body: { name: "Paraguas weekly allowance", type: "SERVICE", category: "SOFTWARE" },
    requestId: crypto.randomUUID(),
  });
  const plan = await paypalFetch<{ id: string }>("/v1/billing/plans", {
    method: "POST",
    body: {
      product_id: product.id,
      name: `${opts.teenName}'s weekly allowance`,
      billing_cycles: [
        {
          frequency: { interval_unit: "WEEK", interval_count: 1 },
          tenure_type: "REGULAR",
          sequence: 1,
          total_cycles: 0,
          pricing_scheme: { fixed_price: { value: dollars(opts.cents), currency_code: "USD" } },
        },
      ],
      payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 2 },
    },
    requestId: crypto.randomUUID(),
  });
  const sub = await paypalFetch<{ id: string; links: Link[] }>("/v1/billing/subscriptions", {
    method: "POST",
    body: {
      plan_id: plan.id,
      application_context: {
        brand_name: "Paraguas",
        user_action: "SUBSCRIBE_NOW",
        return_url: opts.returnUrl,
        cancel_url: opts.cancelUrl,
      },
    },
    requestId: crypto.randomUUID(),
  });
  return { id: sub.id, approveUrl: sub.links.find((l) => l.rel === "approve")?.href || null };
}

/** Verify a webhook with PayPal's signature-verification endpoint. */
export async function verifyPaypalWebhook(headers: Headers, event: unknown) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error("PAYPAL_WEBHOOK_ID is not configured");
  const required = {
    transmission_id: headers.get("paypal-transmission-id"),
    transmission_time: headers.get("paypal-transmission-time"),
    cert_url: headers.get("paypal-cert-url"),
    auth_algo: headers.get("paypal-auth-algo"),
    transmission_sig: headers.get("paypal-transmission-sig"),
  };
  if (Object.values(required).some((value) => !value)) return false;
  const result = await paypalFetch<{ verification_status: string }>(
    "/v1/notifications/verify-webhook-signature",
    {
      method: "POST",
      body: { ...required, webhook_id: webhookId, webhook_event: event },
    },
  );
  return result.verification_status === "SUCCESS";
}

export async function getSubscriptionStatus(id: string) {
  if (!paypalConfigured || id.startsWith("MOCK-")) return "ACTIVE";
  const s = await paypalFetch<{ status: string }>(`/v1/billing/subscriptions/${encodeURIComponent(id)}`);
  return s.status;
}

/** Return a limited, read-only view of a PayPal subscription for the family assistant. */
export async function getPaypalSubscription(id: string) {
  if (!paypalConfigured || id.startsWith("MOCK-")) return { id, status: "ACTIVE", simulated: true };
  const s = await paypalFetch<{
    id: string;
    status: string;
    plan_id?: string;
    start_time?: string;
    billing_info?: { next_billing_time?: string; failed_payments_count?: number };
    subscriber?: { email_address?: string };
  }>(`/v1/billing/subscriptions/${encodeURIComponent(id)}`);
  return {
    id: s.id,
    status: s.status,
    planId: s.plan_id || null,
    startedAt: s.start_time || null,
    nextBillingAt: s.billing_info?.next_billing_time || null,
    failedPayments: s.billing_info?.failed_payments_count ?? 0,
    subscriberEmail: s.subscriber?.email_address || null,
  };
}

/** Read recent PayPal transactions without exposing raw payer or account payloads. */
export async function listPaypalTransactions(days = 7) {
  if (!paypalConfigured) return { simulated: true, transactions: [] };
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const query = new URLSearchParams({
    start_date: start.toISOString(),
    end_date: end.toISOString(),
    fields: "all",
    page_size: "20",
    page: "1",
  });
  const result = await paypalFetch<{
    transaction_details?: {
      transaction_info?: {
        transaction_id?: string;
        transaction_status?: string;
        transaction_amount?: { value?: string; currency?: string };
        transaction_initiation_date?: string;
        transaction_event_code?: string;
      };
      payer_info?: { email_address?: string };
    }[];
  }>(`/v1/reporting/transactions?${query.toString()}`);
  return {
    simulated: false,
    transactions: (result.transaction_details || []).map(({ transaction_info: info, payer_info: payer }) => ({
      id: info?.transaction_id || null,
      status: info?.transaction_status || "UNKNOWN",
      amount: info?.transaction_amount?.value || null,
      currency: info?.transaction_amount?.currency || null,
      date: info?.transaction_initiation_date || null,
      type: info?.transaction_event_code || null,
      payerEmail: payer?.email_address || null,
    })),
  };
}
