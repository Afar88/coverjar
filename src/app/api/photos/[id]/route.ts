import fs from "node:fs";
import path from "node:path";
import { getClaim, UPLOAD_DIR } from "@/lib/db";
import { requireRole } from "@/lib/auth";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = requireRole(req);
  if (!session) return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  const { id } = await ctx.params;
  const claimId = Number(id);
  if (!Number.isSafeInteger(claimId) || claimId <= 0) return new Response("Not found", { status: 404 });
  const claim = getClaim(claimId);
  if (!claim?.photo_file || (session.role === "teen" && claim.member_id !== session.memberId)) return new Response("Not found", { status: 404 });
  const filename = path.basename(claim.photo_file);
  if (filename !== claim.photo_file || !/^[a-f0-9-]+\.(jpg|png|webp)$/.test(filename)) return new Response("Not found", { status: 404 });
  const mime = claim.photo_mime;
  if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") return new Response("Unsupported image", { status: 415 });
  try {
    const data = fs.readFileSync(path.join(/*turbopackIgnore: true*/ UPLOAD_DIR, filename));
    return new Response(data, { headers: {
      "Content-Type": mime,
      "Content-Length": String(data.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff"
    } });
  } catch {
    return new Response("Photo unavailable", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}
