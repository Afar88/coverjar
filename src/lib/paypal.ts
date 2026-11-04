import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";

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
  const res = await paypalFetch<{ batch_header: { payout_batch_id: string; batch_status: string } }>(
    "/v1/payments/payouts",
    {
      method: "POST",
      body: {
        sender_batch_header: {
          sender_batch_id: `paraguas-${opts.itemId}`,
          email_subject: "Paraguas claim payout",
          email_message: opts.note,
        },
        items: [
          {
            recipient_type: "EMAIL",
            amount: { value: dollars(opts.cents), currency: "USD" },
            receiver: opts.email,
            note: opts.note,
            sender_item_id: opts.itemId,
          },
        ],
      },
      requestId: `payout-${opts.itemId}`,
    },
  );
  const batchId = res.batch_header.payout_batch_id;
  let status = res.batch_header.batch_status;
  for (let i = 0; i < 6 && (status === "PENDING" || status === "PROCESSING"); i++) {
    await new Promise((r) => setTimeout(r, 2000));
    status = (await paypalFetch<{ batch_header: { batch_status: string } }>(`/v1/payments/payouts/${batchId}`)).batch_header.batch_status;
  }
  return { batchId, status };
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

export async function getSubscriptionStatus(id: string) {
  if (!paypalConfigured || id.startsWith("MOCK-")) return "ACTIVE";
  const s = await paypalFetch<{ status: string }>(`/v1/billing/subscriptions/${id}`);
  return s.status;
}

let toolkit: PayPalAgentToolkit | null = null;

/** PayPal Agent Toolkit tools the parent's assistant may call (read-mostly; no money leaves without approval). */
export function paypalAgentTools() {
  if (!paypalConfigured) return {};
  toolkit ??= new PayPalAgentToolkit({
    clientId,
    clientSecret,
    configuration: {
      actions: {
        transactions: { list: true },
        orders: { get: true },
        invoices: { create: true, list: true, get: true, send: true },
        subscriptionPlans: { list: true, show: true },
        subscriptions: { show: true },
        products: { list: true },
      },
      context: { sandbox: !isLive },
    },
  });
  return toolkit.getTools();
}
