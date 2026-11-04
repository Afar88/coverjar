import { balances, getClaims, getLedger, getMembers, getRules, getStreakStatus } from "@/lib/db";
import { cryptoEnabled, paypalConfigured, publicClientId } from "@/lib/paypal";
import { geminiConfigured, geminiModelId } from "@/lib/gemini";
import { requireRole } from "@/lib/auth";

export async function GET(req: Request) {
  const session = requireRole(req);
  if (!session) return Response.json({ error: "Sign in to continue" }, { status: 401 });
  const allMembers = getMembers();
  const members = (session.role === "parent" ? allMembers : allMembers.filter((m) => m.id === session.memberId))
    .map((m) => ({ ...m, balances: m.role === "teen" ? balances(m.id) : null, streak: m.role === "teen" ? getStreakStatus(m.id) : null }));
  const claims = (session.role === "parent" ? getClaims() : getClaims(session.memberId))
    .map((c) => ({ ...c, ai: c.ai ? JSON.parse(c.ai) : null }));
  return Response.json({
    members,
    rules: getRules(),
    ledger: getLedger(session.role === "parent" ? undefined : session.memberId, 80),
    claims,
    config: {
      paypal: paypalConfigured ? "sandbox" : "simulated",
      paypalClientId: paypalConfigured ? publicClientId : null,
      cryptoEnabled,
      ai: geminiConfigured ? geminiModelId : "offline-demo",
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
