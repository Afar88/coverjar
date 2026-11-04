import { addLedger, balances, getClaim, getDb, getMember, getRules } from "@/lib/db";
import { toCents } from "@/lib/money";
import { sendPayout } from "@/lib/paypal";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const claim = getClaim(Number(id));
  if (!claim) return Response.json({ error: "Claim not found" }, { status: 404 });
  if (claim.status !== "pending_parent") return Response.json({ error: "Claim already decided" }, { status: 409 });
  const { decision, amount, payee, note } = await req.json();
  const d = getDb();

  if (decision === "deny") {
    d.prepare("UPDATE claims SET status = 'denied', parent_note = ?, decided_at = datetime('now') WHERE id = ?").run(note || null, claim.id);
    return Response.json(getClaim(claim.id));
  }

  const cents = toCents(amount);
  const rules = getRules();
  const jar = balances(claim.member_id).jar;
  if (!(cents > 0)) return Response.json({ error: "Enter a payout amount" }, { status: 400 });
  if (cents > rules.max_payout_cents) return Response.json({ error: "Above the family max payout" }, { status: 400 });
  if (cents > jar) return Response.json({ error: "Not enough in the umbrella fund" }, { status: 400 });

  const parent = getMember("parent")!;
  const email = payee === "parent" ? parent.payout_email || "parent@paraguas.test" : rules.repair_shop_email;
  const lock = d.prepare("UPDATE claims SET status = 'paid', decided_at = datetime('now') WHERE id = ? AND status = 'pending_parent'").run(claim.id);
  if (lock.changes === 0) return Response.json({ error: "Claim already decided" }, { status: 409 });
  try {
    const payout = await sendPayout({
      email,
      cents,
      note: `Paraguas claim #${claim.id}: ${claim.title}`,
      itemId: `claim-${claim.id}`,
    });
    d.prepare("UPDATE claims SET payout_cents = ?, payee_email = ?, paypal_ref = ?, parent_note = ? WHERE id = ?").run(
      cents,
      email,
      payout.batchId,
      note || null,
      claim.id,
    );
    addLedger({
      member_id: claim.member_id,
      bucket: "jar",
      amount_cents: -cents,
      kind: "claim",
      memo: `Claim payout: ${claim.title}`,
      paypal_ref: payout.batchId,
    });
    return Response.json({ ...getClaim(claim.id), payoutStatus: payout.status });
  } catch (e) {
    d.prepare("UPDATE claims SET status = 'pending_parent', decided_at = NULL WHERE id = ?").run(claim.id);
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
