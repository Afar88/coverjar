import { balances, getClaims, getLedger, getMembers, getRules, getStreakStatus } from "@/lib/db";
import { cryptoEnabled, paypalConfigured, publicClientId } from "@/lib/paypal";
import { geminiConfigured, geminiModelId } from "@/lib/gemini";
import { requireRole } from "@/lib/auth";

export async function GET(req:Request) {
  const session=requireRole(req);
  if(!session)return Response.json({error:"Sign in to continue"},{status:401});
  const allMembers=await getMembers();
  const members=await Promise.all((session.role==="parent"?allMembers:allMembers.filter(m=>m.id===session.memberId)).map(async m=>({
    ...m,balances:m.role==="teen"?await balances(m.id):null,streak:m.role==="teen"?await getStreakStatus(m.id):null,
  })));
  const claimRows=await getClaims(session.role==="parent"?undefined:session.memberId);
  const claims=claimRows.map(c=>({...c,ai:c.ai?JSON.parse(c.ai):null}));
  return Response.json({
    members,rules:await getRules(),ledger:await getLedger(session.role==="parent"?undefined:session.memberId,80),claims,
    config:{paypal:paypalConfigured?"sandbox":"simulated",paypalClientId:paypalConfigured?publicClientId:null,cryptoEnabled,ai:geminiConfigured?geminiModelId:"offline-demo"},
  },{headers:{"Cache-Control":"no-store"}});
}
