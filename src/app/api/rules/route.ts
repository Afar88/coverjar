import { getDb, updateRules } from "@/lib/db";
import { toCents } from "@/lib/money";

export async function POST(req: Request) {
  const b = await req.json();
  const patch: Record<string, unknown> = {};
  if (b.jar_percent !== undefined) {
    const p = Math.round(Number(b.jar_percent));
    if (!(p >= 0 && p <= 100)) return Response.json({ error: "Jar % must be 0-100" }, { status: 400 });
    patch.jar_percent = p;
  }
  for (const k of ["deductible", "max_payout"] as const) {
    if (b[k] !== undefined) {
      const c = toCents(b[k]);
      if (!(c >= 0)) return Response.json({ error: `Invalid ${k}` }, { status: 400 });
      patch[`${k}_cents`] = c;
    }
  }
  if (Array.isArray(b.covered)) patch.covered = b.covered.map(String).filter(Boolean);
  if (Array.isArray(b.excluded)) patch.excluded = b.excluded.map(String).filter(Boolean);
  if (typeof b.repair_shop_email === "string") patch.repair_shop_email = b.repair_shop_email.trim();
  if (b.allowances && typeof b.allowances === "object") {
    const stmt = getDb().prepare("UPDATE members SET allowance_cents = ? WHERE id = ? AND role = 'teen'");
    for (const [id, v] of Object.entries(b.allowances)) {
      const c = toCents(v);
      if (c >= 0) stmt.run(c, id);
    }
  }
  return Response.json(updateRules(patch));
}
