import { generateText, tool, type CoreMessage, type Tool } from "ai";
import { z } from "zod";
import { balances, familySnapshot, getClaims, getLedger, getMember, getRules, updateRules } from "@/lib/db";
import { geminiConfigured, geminiModel } from "@/lib/gemini";
import { paypalAgentTools } from "@/lib/paypal";

export async function POST(req: Request) {
  const { role, memberId, messages } = (await req.json()) as { role: "parent" | "teen"; memberId?: string; messages: CoreMessage[] };
  const history = (messages || []).slice(-12);
  if (!geminiConfigured) {
    return Response.json({
      text: "I'm running in offline demo mode (no GEMINI_API_KEY set), so I can't chat yet. Add a Gemini key to turn me on.",
      tools: [],
    });
  }

  let system: string;
  let tools: Record<string, Tool> = {};

  if (role === "teen") {
    const teen = getMember(memberId || "");
    if (!teen) return Response.json({ error: "Unknown teen" }, { status: 400 });
    system = `You are Jarvis, CoverJar's friendly money coach for ${teen.name}${teen.age ? ` (age ${teen.age})` : ""}. Keep answers short (under 120 words), upbeat and concrete. Teach simple ideas: risk, deductibles, saving, needs vs wants. Never promise a claim will be paid: a parent decides. Use your tools to look up real numbers before quoting them.`;
    tools = {
      my_balances: tool({
        description: "Get the teen's spending money and protection jar balance in cents",
        parameters: z.object({}),
        execute: async () => balances(teen.id),
      }),
      my_activity: tool({
        description: "Recent ledger activity for the teen",
        parameters: z.object({}),
        execute: async () => getLedger(teen.id, 20),
      }),
      my_claims: tool({
        description: "The teen's claims and their status",
        parameters: z.object({}),
        execute: async () => getClaims(teen.id).map(({ id, title, status, amount_cents, payout_cents }) => ({ id, title, status, amount_cents, payout_cents })),
      }),
      family_rules: tool({
        description: "What the protection jar covers and its limits",
        parameters: z.object({}),
        execute: async () => getRules(),
      }),
    };
  } else {
    system = `You are CoverJar's assistant for the parent. You help run the family protection jar and the PayPal side of it. Amounts in the app database are in cents; PayPal amounts are in dollars. Be concise. Before changing family rules, state the change you're making. You can use PayPal tools (sandbox) to look up transactions, subscriptions and invoices, and to create and send invoices when the parent asks.`;
    tools = {
      family_snapshot: tool({
        description: "Teens, their balances (cents) and the family rules",
        parameters: z.object({}),
        execute: async () => familySnapshot(),
      }),
      list_claims: tool({
        description: "All claims with status and AI assessment",
        parameters: z.object({}),
        execute: async () => getClaims().map((c) => ({ ...c, ai: c.ai ? JSON.parse(c.ai) : null })),
      }),
      update_jar_rules: tool({
        description: "Change the jar percentage, deductible or max payout",
        parameters: z.object({
          jar_percent: z.number().int().min(0).max(100).optional(),
          deductible_dollars: z.number().min(0).optional(),
          max_payout_dollars: z.number().min(0).optional(),
        }),
        execute: async (a) =>
          updateRules({
            ...(a.jar_percent !== undefined ? { jar_percent: a.jar_percent } : {}),
            ...(a.deductible_dollars !== undefined ? { deductible_cents: Math.round(a.deductible_dollars * 100) } : {}),
            ...(a.max_payout_dollars !== undefined ? { max_payout_cents: Math.round(a.max_payout_dollars * 100) } : {}),
          }),
      }),
      ...(paypalAgentTools() as Record<string, Tool>),
    };
  }

  try {
    const result = await generateText({ model: geminiModel(), system, messages: history, tools, maxSteps: 6 });
    const used = result.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName));
    return Response.json({ text: result.text, tools: [...new Set(used)] });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
