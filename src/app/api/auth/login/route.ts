import { createSession, sessionCookie, verifyLogin } from "@/lib/auth";

export async function POST(req: Request) {
  let body: { role?: string; memberId?: string; pin?: string };
  try { body = await req.json(); } catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }
  const role = body.role;
  const memberId = role === "parent" ? "parent" : String(body.memberId || "");
  const pin = String(body.pin || "");
  if ((role !== "parent" && role !== "teen") || !verifyLogin(role, memberId, pin)) {
    return Response.json({ error: "Incorrect passcode or account" }, { status: 401 });
  }
  const token = createSession(role, memberId);
  return Response.json({ role, memberId }, { headers: { "Set-Cookie": sessionCookie(token), "Cache-Control": "no-store" } });
}
