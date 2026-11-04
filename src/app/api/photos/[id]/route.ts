import fs from "node:fs";
import path from "node:path";
import { getClaim, UPLOAD_DIR } from "@/lib/db";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const claim = getClaim(Number(id));
  if (!claim?.photo_file) return new Response("Not found", { status: 404 });
  const data = fs.readFileSync(path.join(/*turbopackIgnore: true*/ UPLOAD_DIR, path.basename(claim.photo_file)));
  return new Response(data, { headers: { "Content-Type": claim.photo_mime || "image/jpeg" } });
}
