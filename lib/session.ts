import { and, eq, gt } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { env } from "cloudflare:workers";
import { getDb } from "../db";
import { sessions, users } from "../db/schema";
import { randomToken, sha256Hex } from "./crypto";
import type { TradeUser } from "./user";

const COOKIE = "ts_session";
const THIRTY_DAYS = 60 * 60 * 24 * 30;

type AdminEnv = { ADMIN_EMAILS?: string };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isAdminEmail(email: string): boolean {
  const extras = ((env as typeof env & AdminEnv).ADMIN_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return new Set(["eddie@bannermanmenson.com", ...extras]).has(email.toLowerCase());
}

export async function createSessionCookie(userId: number, requestUrl?: string): Promise<string> {
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const expires = new Date(Date.now() + THIRTY_DAYS * 1000).toISOString();
  await getDb().insert(sessions).values({ userId, tokenHash, expiresAt: expires });
  const secure = requestUrl ? new URL(requestUrl).protocol === "https:" : true;
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${THIRTY_DAYS}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function getSessionUser(): Promise<(TradeUser & { role: string; country: string }) | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const now = new Date().toISOString();
  const [row] = await getDb()
    .select({
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      country: users.country,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
    .limit(1);
  if (!row) return null;
  return {
    email: row.email,
    displayName: row.displayName,
    fullName: row.displayName,
    role: row.role,
    country: row.country,
  };
}

export async function getHeaderUser(): Promise<TradeUser | null> {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  if (!email) return null;
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8"
      ? safeDecodeURIComponent(encodedFullName)
      : null;
  return { displayName: fullName ?? email, email, fullName };
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export async function destroyCurrentSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return;
  await getDb().delete(sessions).where(eq(sessions.tokenHash, await sha256Hex(token)));
}
