import fs from "node:fs";
import path from "node:path";
import { getClaim, UPLOAD_DIR } from "@/lib/db";
import { requireRole } from "@/lib/auth";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = requireRole(req);
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const claim = getClaim(Number(id));
  if (!claim?.photo_file || (session.role === "teen" && claim.member_id !== session.memberId)) return new Response("Not found", { status: 404 });
  const data = fs.readFileSync(path.join(/*turbopackIgnore: true*/ UPLOAD_DIR, path.basename(claim.photo_file)));
  return new Response(data, { headers: { "Content-Type": claim.photo_mime || "image/jpeg" } });
}
