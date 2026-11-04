import fs from "node:fs";
import path from "node:path";
import { balances, getClaim, getClaims, getDb, getMember, getRules, UPLOAD_DIR } from "@/lib/db";
import { toCents } from "@/lib/money";
import { assessClaim } from "@/lib/gemini";
import { requireRole } from "@/lib/auth";

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export async function POST(req: Request) {
  const session = requireRole(req, "teen");
  if (!session) return Response.json({ error: "Teen access required" }, { status: 403 });
  const form = await req.formData();
  const teen = getMember(session.memberId);
  const title = String(form.get("title") || "").trim().slice(0, 120);
  const description = String(form.get("description") || "").trim().slice(0, 2000);
  const cents = toCents(form.get("amount"));
  const photo = form.get("photo");
  if (!teen || teen.role !== "teen") return Response.json({ error: "Unknown teen" }, { status: 400 });
  if (!title || !description) return Response.json({ error: "Add a title and say what happened" }, { status: 400 });
  if (!(cents > 0 && cents <= 100000)) return Response.json({ error: "Enter an amount up to $1,000" }, { status: 400 });

  let photoInfo: { data: Buffer; mime: string; file: string } | undefined;
  if (photo instanceof File && photo.size > 0) {
    if (!photo.type.startsWith("image/")) return Response.json({ error: "Photo must be an image" }, { status: 400 });
    if (photo.size > MAX_PHOTO_BYTES) return Response.json({ error: "Photo must be under 8 MB" }, { status: 400 });
    const data = Buffer.from(await photo.arrayBuffer());
    const file = `${crypto.randomUUID()}${path.extname(photo.name) || ".jpg"}`;
    fs.writeFileSync(path.join(/*turbopackIgnore: true*/ UPLOAD_DIR, file), data);
    photoInfo = { data, mime: photo.type, file };
  }

  try {
    const ai = await assessClaim({
      claim: { title, description, amount_cents: cents },
      teenName: teen.name,
      teenAge: teen.age,
      rules: getRules(),
      jarBalance: balances(teen.id).jar,
      previousClaims: getClaims(teen.id).map((c) => ({ title: c.title, status: c.status, created_at: c.created_at })),
      photo: photoInfo,
    });
    const res = getDb()
      .prepare(
        "INSERT INTO claims (member_id, title, description, amount_cents, photo_file, photo_mime, status, ai) VALUES (?, ?, ?, ?, ?, ?, 'pending_parent', ?)",
      )
      .run(teen.id, title, description, cents, photoInfo?.file ?? null, photoInfo?.mime ?? null, JSON.stringify(ai));
    const claim = getClaim(Number(res.lastInsertRowid))!;
    return Response.json({ ...claim, ai });
  } catch (e) {
    return Response.json({ error: `AI review failed: ${(e as Error).message}` }, { status: 502 });
  }
}
