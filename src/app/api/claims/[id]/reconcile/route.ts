import { addLedger, getClaim, getDb } from "@/lib/db";
import { getPayoutStatus } from "@/lib/paypal";
import { requireRole } from "@/lib/auth";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!requireRole(req, "parent")) return Response.json({ error: "Parent access required" }, { status: 403 });
  const { id } = await ctx.params;
  const claimId = Number(id);
  if (!Number.isSafeInteger(claimId) || claimId <= 0) return Response.json({ error: "Invalid claim id" }, { status: 400 });
  const claim = getClaim(claimId);
  if (!claim) return Response.json({ error: "Claim not found" }, { status: 404 });
  if (claim.status !== "payout_pending") return Response.json({ error: "This claim has no payout awaiting reconciliation" }, { status: 409 });
  if (!claim.paypal_ref || !claim.payout_cents) return Response.json({ error: "PayPal reference is missing; keep the reservation in place and contact support" }, { status: 409 });

  let status: { batchStatus: string; itemStatus: string };
  try { status = await getPayoutStatus(claim.paypal_ref, `claim-${claim.id}`); }
  catch (error) { return Response.json({ error: `Could not check PayPal yet: ${(error as Error).message}` }, { status: 502 }); }

  const succeeded = status.batchStatus === "SUCCESS" && status.itemStatus === "SUCCESS";
  const failed = ["DENIED", "CANCELED", "CANCELLED"].includes(status.batchStatus) || ["FAILED", "RETURNED", "BLOCKED", "REFUNDED"].includes(status.itemStatus);
  if (!succeeded && !failed) return Response.json({ ...getClaim(claim.id), payoutStatus: status.itemStatus, batchStatus: status.batchStatus, message: "PayPal has not confirmed a final outcome. The funds remain reserved; check again shortly." }, { status: 202 });

  const d = getDb();
  const updated = d.transaction(() => {
    const current = getClaim(claim.id);
    if (!current || current.status !== "payout_pending" || current.paypal_ref !== claim.paypal_ref) return false;
    if (succeeded) {
      const result = d.prepare("UPDATE claims SET status = 'paid', decided_at = datetime('now') WHERE id = ? AND status = 'payout_pending' AND paypal_ref = ?").run(claim.id, claim.paypal_ref);
      return result.changes > 0;
    }
    const result = d.prepare("UPDATE claims SET status = 'payout_failed', decided_at = datetime('now') WHERE id = ? AND status = 'payout_pending' AND paypal_ref = ?").run(claim.id, claim.paypal_ref);
    if (result.changes > 0) addLedger({
      member_id: claim.member_id,
      bucket: "jar",
      amount_cents: claim.payout_cents!,
      kind: "claim_release",
      memo: `Released failed claim reservation: ${claim.title}`,
      paypal_ref: claim.paypal_ref,
    });
    return result.changes > 0;
  })();
  if (!updated) return Response.json({ error: "Claim changed while checking PayPal. Refresh and review its current status." }, { status: 409 });
  return Response.json({ ...getClaim(claim.id), payoutStatus: status.itemStatus, batchStatus: status.batchStatus });
}
