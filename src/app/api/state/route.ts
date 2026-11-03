import { balances, getClaims, getLedger, getMembers, getRules } from "@/lib/db";
import { cryptoEnabled, paypalConfigured, publicClientId } from "@/lib/paypal";
import { geminiConfigured, geminiModelId } from "@/lib/gemini";

export async function GET() {
  const members = getMembers().map((m) => ({ ...m, balances: m.role === "teen" ? balances(m.id) : null }));
  const claims = getClaims().map((c) => ({ ...c, ai: c.ai ? JSON.parse(c.ai) : null }));
  return Response.json({
    members,
    rules: getRules(),
    ledger: getLedger(undefined, 80),
    claims,
    config: {
      paypal: paypalConfigured ? "sandbox" : "simulated",
      paypalClientId: paypalConfigured ? publicClientId : null,
      cryptoEnabled,
      ai: geminiConfigured ? geminiModelId : "offline-demo",
    },
  });
}
