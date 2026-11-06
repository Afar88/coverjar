import { clearSessionCookie } from "@/lib/auth";

function logoutResponse() {
  return Response.json({ ok: true }, {
    headers: {
      "Set-Cookie": clearSessionCookie(),
      "Cache-Control": "no-store, max-age=0",
      "Pragma": "no-cache",
    },
  });
}

export async function POST() {
  return logoutResponse();
}

// Also support direct navigation as a reliable mobile-browser fallback.
export async function GET() {
  return new Response(null, {
    status: 303,
    headers: {
      "Location": "/",
      "Set-Cookie": clearSessionCookie(),
      "Cache-Control": "no-store, max-age=0",
      "Pragma": "no-cache",
    },
  });
}
