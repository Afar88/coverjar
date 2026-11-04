import { createHmac, timingSafeEqual } from "node:crypto";
import { getMember } from "@/lib/db";

export type Session = { role: "parent" | "teen"; memberId: string; expiresAt: number };
const COOKIE = "paraguas_session";
const MAX_AGE = 60 * 60 * 12;

function secret() {
  const value = process.env.PARAGUAS_SESSION_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV !== "production") return "local-development-only-paraguas-session-secret";
  throw new Error("PARAGUAS_SESSION_SECRET must be configured");
}

function sign(value: string) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createSession(role: Session["role"], memberId: string) {
  const payload: Session = { role, memberId, expiresAt: Date.now() + MAX_AGE * 1000 };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function readSession(req: Request): Session | null {
  try {
    const cookie = req.headers.get("cookie") || "";
    const token = cookie.split(";").map((v) => v.trim()).find((v) => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    if (!token) return null;
    const [encoded, signature] = token.split(".");
    if (!encoded || !signature || !safeEqual(signature, sign(encoded))) return null;
    const session = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Session;
    if (!["parent", "teen"].includes(session.role) || !session.memberId || session.expiresAt <= Date.now()) return null;
    const member = getMember(session.memberId);
    if (!member || member.role !== session.role) return null;
    return session;
  } catch {
    return null;
  }
}

export function requireRole(req: Request, role?: Session["role"]): Session | null {
  const session = readSession(req);
  return session && (!role || session.role === role) ? session : null;
}

export function sessionCookie(token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}${secure}`;
}

export function clearSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

export function verifyLogin(role: Session["role"], memberId: string, pin: string) {
  const member = getMember(memberId);
  if (!member || member.role !== role || !/^\\d{4,12}$/.test(pin)) return false;
  const configured = role === "parent" ? process.env.PARAGUAS_PARENT_PIN : process.env.PARAGUAS_TEEN_PIN;
  const expected = configured || (process.env.NODE_ENV !== "production" ? (role === "parent" ? "2468" : "1357") : "");
  return Boolean(expected) && safeEqual(pin, expected);
}
