import { addLedger, balances, getClaim, getDb, getMember, getRules } from "@/lib/db";
import { toCents } from "@/lib/money";
import { sendPayout } from "@/lib/paypal";
import { requireRole } from "@/lib/auth";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!requireRole(req, "parent")) return Response.json({ error: "Parent access required" }, { status: 403 });
  const { id } = await ctx.params;
  const claimId = Number(id);
  if (!Number.isSafeInteger(claimId) || claimId <= 0) return Response.json({ error: "Invalid claim id" }, { status: 400 });

  let body: { decision?: string; amount?: unknown; payee?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const claim = getClaim(claimId);
  if (!claim) return Response.json({ error: "Claim not found" }, { status: 404 });
  const d = getDb();

  if (body.decision === "deny") {
    const result = d.prepare(
      "UPDATE claims SET status = 'denied', parent_note = ?, decided_at = datetime('now') WHERE id = ? AND status = 'pending_parent'",
    ).run(typeof body.note === "string" ? body.note.slice(0, 500) : null, claim.id);
    if (result.changes === 0) return Response.json({ error: "Claim already decided or payout is in progress" }, { status: 409 });
    return Response.json(getClaim(claim.id));
  }

  if (body.decision !== "approve") return Response.json({ error: "Choose approve or deny" }, { status: 400 });

  const cents = toCents(body.amount);
  const rules = getRules();
  if (!(cents > 0)) return Response.json({ error: "Enter a payout amount" }, { status: 400 });
  if (cents > rules.max_payout_cents) return Response.json({ error: "Above the family max payout" }, { status: 400 });
  if (cents > claim.amount_cents) return Response.json({ error: "Payout cannot exceed the amount requested in this claim" }, { status: 400 });

  const parent = getMember("parent");
  if (!parent) return Response.json({ error: "Parent account is missing" }, { status: 500 });
  const email = body.payee === "parent" ? parent.payout_email || "parent@paraguas.test" : rules.repair_shop_email;
  const note = typeof body.note === "string" ? body.note.slice(0, 500) : null;

  // Reserve the money and lock the claim together. This prevents two approved
  // claims from spending the same jar balance while PayPal is processing.
  const reserve = d.transaction(() => {
    if (cents > balances(claim.member_id).jar) throw new Error("Not enough in the umbrella fund");
    const lock = d.prepare(
      "UPDATE claims SET status = 'payout_pending', payout_cents = ?, payee_email = ?, parent_note = ?, decided_at = datetime('now') WHERE id = ? AND status = 'pending_parent'",
    ).run(cents, email, note, claim.id);
    if (lock.changes === 0) throw new Error("Claim already decided");
    addLedger({
      member_id: claim.member_id,
      bucket: "jar",
      amount_cents: -cents,
      kind: "claim_reserve",
      memo: `Reserved for claim payout: ${claim.title}`,
      paypal_ref: null,
    });
  });

  try {
    reserve();
  } catch (e) {
    const message = (e as Error).message;
    return Response.json({ error: message }, { status: message === "Not enough in the umbrella fund" ? 400 : 409 });
  }

  try {
    const payout = await sendPayout({
      email,
      cents,
      note: `Paraguas claim #${claim.id}: ${claim.title}`,
      itemId: `claim-${claim.id}`,
    });

    if (payout.status === "DENIED" || payout.status === "CANCELED") {
      d.transaction(() => {
        const changed = d.prepare("UPDATE claims SET status = 'payout_failed', paypal_ref = ? WHERE id = ? AND status = 'payout_pending'")
          .run(payout.batchId, claim.id);
        if (changed.changes) addLedger({
          member_id: claim.member_id,
          bucket: "jar",
          amount_cents: cents,
          kind: "claim_release",
          memo: `Released failed claim reservation: ${claim.title}`,
          paypal_ref: payout.batchId,
        });
      })();
      return Response.json({ ...getClaim(claim.id), payoutStatus: payout.status }, { status: 502 });
    }

    if (payout.status !== "SUCCESS" && payout.status !== "SUCCESS (simulated)") {
      d.prepare("UPDATE claims SET paypal_ref = ? WHERE id = ? AND status = 'payout_pending'").run(payout.batchId, claim.id);
      return Response.json({ ...getClaim(claim.id), payoutStatus: payout.status, message: "PayPal is still processing this payout." }, { status: 202 });
    }

    d.prepare(
      "UPDATE claims SET status = 'paid', paypal_ref = ?, decided_at = datetime('now') WHERE id = ? AND status = 'payout_pending'",
    ).run(payout.batchId, claim.id);
    return Response.json({ ...getClaim(claim.id), payoutStatus: payout.status });
  } catch (e) {
    // A timeout can happen after PayPal accepted a transfer. Keep the funds
    // reserved and the claim pending until reconciled; do not risk a duplicate.
    return Response.json({
      ...getClaim(claim.id),
      payoutStatus: "UNKNOWN",
      message: `Payout outcome needs reconciliation before retrying: ${(e as Error).message}`,
    }, { status: 202 });
  }
}
