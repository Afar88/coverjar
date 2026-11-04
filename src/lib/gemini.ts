import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import type { Claim, Rules } from "./db";

export const geminiConfigured = Boolean(process.env.GEMINI_API_KEY);
export const geminiModelId = process.env.GEMINI_MODEL || "gemini-3.8-flash";

const fallbackModelIds = [geminiModelId, ...(process.env.GEMINI_FALLBACK_MODELS || "gemini-3-flash-preview,gemini-3.5-flash,gemini-flash-latest").split(",")]
  .map((m) => m.trim())
  .filter((m, i, all) => m && all.indexOf(m) === i);

export function geminiModel(id = geminiModelId) {
  const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });
  return google(id);
}

/** Runs `fn` against the primary Gemini model, falling back to the next model when one is overloaded or failing. */
export async function withGemini<T>(fn: (model: ReturnType<typeof geminiModel>, id: string) => Promise<T>): Promise<{ result: T; modelId: string }> {
  let lastError: unknown;
  for (const id of fallbackModelIds) {
    try {
      return { result: await fn(geminiModel(id), id), modelId: id };
    } catch (e) {
      lastError = e;
      console.warn(`Gemini model ${id} failed: ${(e as Error).message}`);
    }
  }
  throw lastError;
}

export const assessmentSchema = z.object({
  covered: z.boolean().describe("Whether the family rules cover this claim"),
  category: z.string().describe("Short item category, e.g. 'Phone screen', 'Bike wheel'"),
  coverage_reason: z.string().describe("One or two sentences citing the specific family rule that applies"),
  damage_observed: z.string().describe("What the photo actually shows. Say so plainly if there is no photo or it is unclear."),
  photo_matches_description: z.boolean(),
  estimated_repair_cents: z.number().int().describe("Typical US repair cost in cents for the damage seen"),
  recommended_payout_cents: z.number().int().describe("Suggested payout in cents before family caps are applied"),
  confidence: z.number().min(0).max(1),
  risk_flags: z.array(z.string()).describe("Concerns a parent should check, e.g. photo mismatch, frequent claims, amount far above typical cost"),
  parent_summary: z.string().describe("2-3 sentences for the parent: what happened, the recommendation, anything to double-check"),
  teen_message: z.string().describe("Warm, short message to the teen explaining the outcome plus one practical tip to avoid this next time"),
  payee: z.enum(["repair_shop", "parent"]).describe("Pay the repair shop directly for repairs, or the parent for replacements"),
});

export type Assessment = z.infer<typeof assessmentSchema> & {
  final_payout_cents: number;
  caps_applied: string[];
  model: string;
};

export function applyFamilyCaps(
  raw: z.infer<typeof assessmentSchema>,
  claim: Pick<Claim, "amount_cents">,
  rules: Rules,
  jarBalance: number,
  model: string,
): Assessment {
  const caps: string[] = [];
  let payout = raw.covered ? raw.recommended_payout_cents : 0;
  const afterDeductible = Math.max(0, claim.amount_cents - rules.deductible_cents);
  if (payout > afterDeductible) {
    payout = afterDeductible;
    caps.push(`Claim amount minus $${(rules.deductible_cents / 100).toFixed(2)} deductible`);
  }
  if (payout > rules.max_payout_cents) {
    payout = rules.max_payout_cents;
    caps.push("Family max payout per claim");
  }
  if (payout > jarBalance) {
    payout = Math.max(0, jarBalance);
    caps.push("Protection jar balance");
  }
  return { ...raw, final_payout_cents: payout, caps_applied: caps, model };
}

function heuristicAssessment(claim: Pick<Claim, "title" | "description" | "amount_cents">, rules: Rules, history: number) {
  const text = `${claim.title} ${claim.description}`.toLowerCase();
  const excluded = /on purpose|lost|scratch|lent|borrow/.test(text);
  const item = /phone|screen|tablet|ipad|laptop|headphone|airpod|bike|calculator/.exec(text)?.[0] || "item";
  const estimate = { phone: 12000, screen: 12000, tablet: 15000, ipad: 15000, laptop: 25000, headphone: 6000, airpod: 8000, bike: 5000, calculator: 3000 }[item] ?? 5000;
  const flags = [] as string[];
  if (history >= 2) flags.push(`${history} earlier claims on record`);
  if (claim.amount_cents > estimate * 1.5) flags.push("Amount is well above a typical repair cost");
  flags.push("Offline demo assessment (no GEMINI_API_KEY set): photo was not analysed");
  return {
    covered: !excluded,
    category: item[0].toUpperCase() + item.slice(1),
    coverage_reason: excluded
      ? `Looks like an exclusion applies: ${rules.excluded.join("; ")}.`
      : `Matches the rule "${rules.covered[0]}".`,
    damage_observed: "Photo not analysed in offline demo mode.",
    photo_matches_description: true,
    estimated_repair_cents: estimate,
    recommended_payout_cents: excluded ? 0 : Math.min(claim.amount_cents, estimate),
    confidence: 0.4,
    risk_flags: flags,
    parent_summary: excluded
      ? "This claim seems to fall under an exclusion, so the recommendation is to decline."
      : `Accidental damage to a ${item}. Recommended payout is capped at a typical repair cost.`,
    teen_message: excluded
      ? "This one isn't covered by the family rules, but your jar is still growing for next time."
      : "Sorry about the damage! A sturdy case or keeping it in a zipped pocket can stop this happening again.",
    payee: "repair_shop" as const,
  };
}

export async function assessClaim(opts: {
  claim: Pick<Claim, "title" | "description" | "amount_cents">;
  teenName: string;
  teenAge: number | null;
  rules: Rules;
  jarBalance: number;
  previousClaims: { title: string; status: string; created_at: string }[];
  photo?: { data: Buffer; mime: string };
}): Promise<Assessment> {
  const { claim, rules, jarBalance } = opts;
  if (!geminiConfigured) {
    return applyFamilyCaps(heuristicAssessment(claim, rules, opts.previousClaims.length), claim, rules, jarBalance, "offline-demo");
  }
  const prompt = `You are Paraguas's claims reviewer for a family "protection jar": a self-funded pool that teens pay into from their allowance to cover accidents to their stuff. You are fair, kind and careful with money. Parents make the final call.

Family rules
- Covered: ${rules.covered.join("; ")}
- Not covered: ${rules.excluded.join("; ")}
- Deductible: $${(rules.deductible_cents / 100).toFixed(2)} per claim
- Max payout per claim: $${(rules.max_payout_cents / 100).toFixed(2)}
- Current jar balance: $${(jarBalance / 100).toFixed(2)}

Claimant: ${opts.teenName}${opts.teenAge ? `, age ${opts.teenAge}` : ""}
Previous claims: ${opts.previousClaims.length ? opts.previousClaims.map((c) => `${c.title} (${c.status}, ${c.created_at})`).join("; ") : "none"}

New claim
- Title: ${claim.title}
- What happened: ${claim.description}
- Amount requested: $${(claim.amount_cents / 100).toFixed(2)}
${opts.photo ? "A photo of the damage is attached. Inspect it closely and compare it with the description." : "No photo was provided; flag this."}

Recommend a payout no higher than a realistic repair (or replacement if unrepairable) cost. Do not apply the deductible or caps yourself; the app enforces those.`;

  const content: ({ type: "text"; text: string } | { type: "image"; image: Buffer; mediaType: string })[] = [
    { type: "text", text: prompt },
  ];
  if (opts.photo) content.push({ type: "image", image: opts.photo.data, mediaType: opts.photo.mime });

  const { result: { object }, modelId } = await withGemini((model) =>
    generateObject({ model, schema: assessmentSchema, messages: [{ role: "user", content }], maxRetries: 1 }),
  );
  return applyFamilyCaps(object, claim, rules, jarBalance, modelId);
}
