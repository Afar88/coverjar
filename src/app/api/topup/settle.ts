import { creditAllowance, getDb, getMember } from "@/lib/db";

type Payment = { order_id: string; member_id: string; amount_cents: number; method: string; status: string };

/** Marks a PayPal order as paid and credits the teen exactly once. */
export function settlePayment(orderId: string, captureId: string) {
  const d = getDb();
  const p = d.prepare("SELECT * FROM payments WHERE order_id = ?").get(orderId) as Payment | undefined;
  if (!p) throw new Error("Unknown order");
  if (p.status === "COMPLETED") return { alreadySettled: true, payment: p };
  const res = d.prepare("UPDATE payments SET status = 'COMPLETED' WHERE order_id = ? AND status != 'COMPLETED'").run(orderId);
  if (res.changes === 0) return { alreadySettled: true, payment: p };
  const teen = getMember(p.member_id)!;
  const label = p.method === "crypto" ? "Allowance top-up (paid with crypto/PYUSD)" : "Allowance top-up via PayPal";
  const split = creditAllowance(teen.id, p.amount_cents, captureId, label);
  return { alreadySettled: false, payment: p, split };
}
