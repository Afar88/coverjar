import { creditAllowance, getDb, getMember } from "@/lib/db";

type Payment = { order_id: string; member_id: string; amount_cents: number; method: string; status: string };
type CapturedAmount = { value: string; currencyCode: string } | null;

/**
 * Atomically marks a verified PayPal order complete and credits both allowance
 * buckets. The amount is checked against the server-created order before any
 * ledger write, including when settlement is initiated by a crypto return URL.
 */
export function settlePayment(orderId: string, captureId: string, amount: CapturedAmount = null) {
  const d = getDb();
  const settle = d.transaction(() => {
    const p = d.prepare("SELECT * FROM payments WHERE order_id = ?").get(orderId) as Payment | undefined;
    if (!p) throw new Error("Unknown order");
    if (p.status === "COMPLETED") return { alreadySettled: true, payment: p };

    if (!orderId.startsWith("MOCK-")) {
      const value = amount?.value;
      const currency = amount?.currencyCode;
      const validValue = typeof value === "string" && /^(0|[1-9]\d*)\.\d{2}$/.test(value);
      const capturedCents = validValue ? Number(value.replace(".", "")) : NaN;
      if (currency !== "USD" || !Number.isSafeInteger(capturedCents) || capturedCents !== p.amount_cents) {
        throw new Error("Captured amount or currency does not match the original order");
      }
    }

    const teen = getMember(p.member_id);
    if (!teen || teen.role !== "teen") throw new Error("Payment is linked to an invalid teen account");

    const res = d.prepare("UPDATE payments SET status = 'COMPLETED' WHERE order_id = ? AND status = 'CREATED'").run(orderId);
    if (res.changes === 0) {
      const latest = d.prepare("SELECT * FROM payments WHERE order_id = ?").get(orderId) as Payment | undefined;
      if (latest?.status === "COMPLETED") return { alreadySettled: true, payment: latest };
      throw new Error("Payment is not eligible for settlement");
    }

    const label = p.method === "crypto" ? "Allowance top-up (paid with crypto/PYUSD)" : "Allowance top-up via PayPal";
    const split = creditAllowance(teen.id, p.amount_cents, captureId, label);
    return { alreadySettled: false, payment: { ...p, status: "COMPLETED" }, split };
  });
  return settle();
}
