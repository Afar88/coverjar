import { getMembers } from "@/lib/db";
export async function GET() {
  return Response.json({ teens: getMembers().filter((m) => m.role === "teen").map(({ id, name, emoji }) => ({ id, name, emoji })) }, { headers: { "Cache-Control": "no-store" } });
}
