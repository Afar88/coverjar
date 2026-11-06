import { generateText, stepCountIs, tool, type ModelMessage, type Tool } from "ai";
import { z } from "zod";
import { balances, consumeRateLimit, familySnapshot, getClaims, getLedger, getMember, getRules } from "@/lib/db";
import { geminiConfigured, withGemini } from "@/lib/gemini";
import { getPaypalSubscription, listPaypalTransactions } from "@/lib/paypal";
import { requireRole } from "@/lib/auth";

export const maxDuration = 30;

export async function POST(req:Request) {
  const session=requireRole(req);
  if(!session)return Response.json({error:"Sign in to chat"},{status:401});
  const rate=await consumeRateLimit(`chat:${session.familyId}:${session.memberId}`,30,60*60*1000);
  if(!rate.allowed)return Response.json({error:"You have reached the chat limit for now. Please try again later."},{status:429,headers:{"Retry-After":String(rate.retryAfterSeconds),"Cache-Control":"no-store"}});
  let body: { messages?: unknown };
  try { body = await req.json(); } catch {
    return Response.json({ error: "The message could not be read. Please try again." }, { status: 400 });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 30) {
    return Response.json({ error: "Send a message before asking the assistant." }, { status: 400 });
  }
  const history = body.messages.slice(-8) as ModelMessage[];
  if (history.some((message) => !message || !["user", "assistant"].includes(message.role) ||
    !Array.isArray(message.content) && typeof message.content !== "string")) {
    return Response.json({ error: "The conversation format is invalid. Please start a new message." }, { status: 400 });
  }
  const role=session.role; const memberId=session.memberId;
  if(!geminiConfigured)return Response.json({text:"I'm running in offline demo mode (no GEMINI_API_KEY set), so I can't chat yet. Add a Gemini key to turn me on.",tools:[]});
  let system:string; let tools:Record<string,Tool>={};
  if(role==="teen") {
    const teen=await getMember(memberId,undefined,session.familyId);
    if(!teen)return Response.json({error:"Unknown teen"},{status:400});
    system=`You are Jarvis, Paraguas's friendly money coach for ${teen.name}${teen.age?` (age ${teen.age})`:""}. Keep answers short (under 120 words), upbeat and concrete. Teach simple ideas: risk, deductibles, saving, needs vs wants. Never promise a claim will be paid: a parent decides. Use your tools to look up real numbers before quoting them.`;
    tools={
      my_balances:tool({description:"Get the teen's spending money and umbrella fund balance in cents",inputSchema:z.object({}),execute:async()=>balances(teen.id,undefined,session.familyId)}),
      my_activity:tool({description:"Recent ledger activity for the teen",inputSchema:z.object({}),execute:async()=>getLedger(teen.id,20,session.familyId)}),
      my_claims:tool({description:"The teen's claims and their status",inputSchema:z.object({}),execute:async()=>(await getClaims(teen.id,session.familyId)).map(({id,title,status,amount_cents,payout_cents})=>({id,title,status,amount_cents,payout_cents}))}),
      family_rules:tool({description:"What the umbrella fund covers and its limits",inputSchema:z.object({}),execute:async()=>getRules(undefined,session.familyId)}),
    };
  } else {
    system="You are Paraguas's assistant for the parent. You help run the family umbrella fund and the PayPal side of it. Amounts in the app database are in cents; PayPal amounts are in dollars. Be concise. You may explain suggested family-rule changes, but you cannot change rules or financial settings. Direct the parent to the Family rules screen to review and save changes themselves. You can use read-only PayPal tools to look up recent transactions and subscription status. Never claim to create or send an invoice.";
    tools={
      family_snapshot:tool({description:"Teens, their balances (cents) and the family rules",inputSchema:z.object({}),execute:async()=>familySnapshot(session.familyId)}),
      list_claims:tool({description:"All claims with status and AI assessment",inputSchema:z.object({}),execute:async()=>(await getClaims(undefined,session.familyId)).map(c=>({...c,ai:c.ai?JSON.parse(c.ai):null}))}),
      paypal_recent_transactions:tool({description:"List the most recent PayPal transactions for the connected merchant account",inputSchema:z.object({days:z.number().int().min(1).max(90).default(7)}),execute:async({days})=>{try{return await listPaypalTransactions(days)}catch{return {unavailable:true,message:"PayPal transaction lookup is temporarily unavailable. You can still ask me about family balances and claims."}}}}),
      paypal_subscription_status:tool({description:"Look up the status and next billing date of a PayPal subscription using its subscription ID",inputSchema:z.object({subscription_id:z.string().min(5).max(128)}),execute:async({subscription_id})=>{try{return await getPaypalSubscription(subscription_id)}catch{return {unavailable:true,message:"PayPal subscription lookup is temporarily unavailable. Please check the subscription in PayPal and try again."}}}}),
    };
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  try {
    const response = await Promise.race([
      withGemini(model => generateText({
        model, system, messages: history, tools,
        stopWhen: stepCountIs(role === "parent" ? 2 : 4), maxRetries: 0, abortSignal: controller.signal,
      })),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => { controller.abort(); reject(new Error("The assistant took too long to respond. Please try again in a moment.")); }, 22000);
      }),
    ]);
    const used=response.result.steps.flatMap(s=>s.toolCalls.map(c=>c.toolName));
    if (!response.result.text?.trim()) {
      return Response.json({ error: "The assistant returned an empty reply. Please try again." }, { status: 502 });
    }
    return Response.json({text:response.result.text,tools:[...new Set(used)]}, { headers: { "Cache-Control": "no-store" } });
  } catch(e) {
    console.error("Paraguas chat request failed:", e);
    return Response.json({error:"The assistant is temporarily unavailable. Please try again."},{status:502,headers:{"Cache-Control":"no-store"}});
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
