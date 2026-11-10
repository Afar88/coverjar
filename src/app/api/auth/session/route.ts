import { readSession } from "@/lib/auth";
import { getFamilyById } from "@/lib/db";

export async function GET(req: Request) {
  const session = readSession(req);
  if (!session) return Response.json({ authenticated: false, session: null }, { headers: { "Cache-Control": "no-store" } });
  // Only return the family code to the authenticated parent, never to teen sessions.
  const family = session.role === "parent" ? await getFamilyById(session.familyId) : null;
  return Response.json({ authenticated: true, session, familyCode: family?.code ?? null }, { headers: { "Cache-Control": "no-store" } });
}
