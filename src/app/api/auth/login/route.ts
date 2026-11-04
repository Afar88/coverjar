import { createSession, sessionCookie, verifyLogin } from "@/lib/auth";
import { consumeRateLimit } from "@/lib/db";

const LOGIN_LIMIT = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export async function POST(req: Request) {
  let body: { role?: string; memberId?: string; pin?: string };
  try { body = await req.json(); } catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }
  const role = body.role;
  const memberId = role === "parent" ? "parent" : String(body.memberId || "");
  if ((role !== "parent" && role !== "teen") || !/^[a-zA-Z0-9_-]{1,64}$/.test(memberId)) {
    return Response.json({ error: "Incorrect passcode or account" }, { status: 401 });
  }

  // Limit by account, not a caller-controlled IP header. The parent account is
  // one shared key; teen accounts each receive their own independent window.
  const rate = consumeRateLimit(`login:${role}:${memberId}`, LOGIN_LIMIT, LOGIN_WINDOW_MS);
  if (!rate.allowed) {
    return Response.json(
      { error: "Too many login attempts. Please wait before trying again." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds), "Cache-Control": "no-store" } },
    );
  }

  const pin = String(body.pin || "");
  if (!verifyLogin(role, memberId, pin)) {
    return Response.json({ error: "Incorrect passcode or account" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const token = createSession(role, memberId);
  return Response.json({ role, memberId }, { headers: { "Set-Cookie": sessionCookie(token), "Cache-Control": "no-store" } });
}
