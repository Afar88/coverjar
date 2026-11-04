import { del, get, put } from "@vercel/blob";
import { randomUUID } from "node:crypto";

export type ClaimPhoto = {
  pathname: string;
  contentType: "image/jpeg" | "image/png" | "image/webp";
};

function assertBlobConfigured() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is required for private claim-photo storage");
  }
}

/** Store claim evidence in a private Vercel Blob store; persist only its opaque pathname. */
export async function saveClaimPhoto(
  data: Buffer,
  contentType: ClaimPhoto["contentType"],
  extension: ".jpg" | ".png" | ".webp",
): Promise<ClaimPhoto> {
  assertBlobConfigured();
  const pathname = `claims/${randomUUID()}${extension}`;
  const blob = await put(pathname, data, {
    access: "private",
    addRandomSuffix: false,
    contentType,
    cacheControlMaxAge: 0,
  });
  return { pathname: blob.pathname, contentType };
}

/** Read a private blob by its stored pathname, never by a user-supplied URL. */
export async function readClaimPhoto(pathname: string) {
  assertBlobConfigured();
  if (!/^claims\/[a-f0-9-]+\.(jpg|png|webp)$/.test(pathname)) return null;
  return get(pathname, { access: "private" });
}

export async function deleteClaimPhoto(pathname: string) {
  assertBlobConfigured();
  if (!/^claims\/[a-f0-9-]+\.(jpg|png|webp)$/.test(pathname)) return;
  await del(pathname, { access: "private" });
}
