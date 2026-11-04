import { readSession } from "@/lib/auth";

export async function GET(req: Request) {
  const session = readSession(req);
  return Response.json({ authenticated: Boolean(session), session }, { headers: { "Cache-Control": "no-store" } });
}
