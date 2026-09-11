// Server-side sessions backed by D1, with an HMAC-signed cookie.
//
// The cookie value is `${sessionId}.${signatureHex}`. `sessionId` is a
// random, unguessable 256-bit value used to look the session up in D1;
// the signature (HMAC-SHA256 over sessionId, keyed by env.SESSION_SECRET)
// stops a client from presenting an arbitrary/forged session id — without
// SESSION_SECRET, a valid-looking cookie cannot be constructed even if the
// `sessions` table were somehow exposed. Sessions are revocable server-side
// at any time (sign-out, suspension, "sign out everywhere"), which a bare
// signed JWT would not give us.
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import { sessions, users } from "../../db/schema";

export const SESSION_COOKIE_NAME = "ts_session";
const SESSION_LIFETIME_DAYS = 30;
const SESSION_REFRESH_THRESHOLD_DAYS = 7; // refresh expiry if less than this remains

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function sign(sessionId: string): Promise<string> {
  const key = await hmacKey();
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(sessionId));
  return toHex(new Uint8Array(signature));
}

async function verifySignature(sessionId: string, signatureHex: string): Promise<boolean> {
  try {
    const key = await hmacKey();
    return await crypto.subtle.verify("HMAC", key, fromHex(signatureHex) as BufferSource, new TextEncoder().encode(sessionId));
  } catch {
    return false;
  }
}

function newSessionId(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

export type SessionUser = {
  id: number;
  email: string;
  displayName: string;
  platformRole: "administrator" | "verification_analyst" | null;
  status: string;
  emailVerifiedAt: string | null;
};

export async function createSession(
  userId: number,
  request: { ip?: string; userAgent?: string },
): Promise<{ cookieValue: string; expiresAt: string }> {
  const id = newSessionId();
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_DAYS * 86_400_000).toISOString();
  await getDb().insert(sessions).values({
    id,
    userId,
    expiresAt,
    ip: request.ip ?? "",
    userAgent: (request.userAgent ?? "").slice(0, 512),
  });
  const signature = await sign(id);
  return { cookieValue: `${id}.${signature}`, expiresAt };
}

/** Look up the session named by a raw cookie value and return its user, or
 * null if the cookie is missing, malformed, forged, expired, revoked, or
 * belongs to a suspended/deleted account. Refreshes a near-expiry session's
 * expiry (sliding session) as a side effect. */
export async function resolveSession(cookieValue: string | undefined | null): Promise<SessionUser | null> {
  if (!cookieValue) return null;
  const dot = cookieValue.indexOf(".");
  if (dot < 0) return null;
  const sessionId = cookieValue.slice(0, dot);
  const signature = cookieValue.slice(dot + 1);
  if (!(await verifySignature(sessionId, signature))) return null;

  const db = getDb();
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (!row) return null;
  if (row.session.revokedAt) return null;
  if (new Date(row.session.expiresAt).getTime() <= Date.now()) return null;
  if (row.user.status !== "active") return null;

  const now = Date.now();
  const refreshBefore = new Date(row.session.expiresAt).getTime() - SESSION_REFRESH_THRESHOLD_DAYS * 86_400_000;
  if (now > refreshBefore) {
    const nextExpiry = new Date(now + SESSION_LIFETIME_DAYS * 86_400_000).toISOString();
    await db
      .update(sessions)
      .set({ expiresAt: nextExpiry, lastSeenAt: new Date().toISOString() })
      .where(eq(sessions.id, sessionId));
  } else {
    await db.update(sessions).set({ lastSeenAt: new Date().toISOString() }).where(eq(sessions.id, sessionId));
  }

  return {
    id: row.user.id,
    email: row.user.email,
    displayName: row.user.displayName,
    platformRole: (row.user.platformRole as SessionUser["platformRole"]) ?? null,
    status: row.user.status,
    emailVerifiedAt: row.user.emailVerifiedAt,
  };
}

export async function revokeSessionByCookie(cookieValue: string | undefined | null): Promise<void> {
  if (!cookieValue) return;
  const dot = cookieValue.indexOf(".");
  if (dot < 0) return;
  const sessionId = cookieValue.slice(0, dot);
  await getDb().update(sessions).set({ revokedAt: new Date().toISOString() }).where(eq(sessions.id, sessionId));
}

/** Revoke every session for a user — used on password change, suspension,
 * and "sign out everywhere". */
export async function revokeAllSessionsForUser(userId: number): Promise<void> {
  await getDb().update(sessions).set({ revokedAt: new Date().toISOString() }).where(eq(sessions.userId, userId));
}

/** Build the Set-Cookie header value. `secure` must reflect whether the
 * current request is actually HTTPS — browsers silently refuse to set a
 * `Secure` cookie over plain HTTP, which would otherwise break local dev
 * (`vinext dev` serves over http://localhost). Pass
 * `new URL(request.url).protocol === "https:"`. */
export function sessionCookieHeader(
  cookieValue: string,
  secure: boolean,
  maxAgeSeconds = SESSION_LIFETIME_DAYS * 86_400,
): string {
  const attrs = [
    `${SESSION_COOKIE_NAME}=${cookieValue}`,
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Strict",
    ...(secure ? ["Secure"] : []),
  ];
  return attrs.join("; ");
}

export function clearSessionCookieHeader(secure: boolean): string {
  const attrs = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Strict",
    ...(secure ? ["Secure"] : []),
  ];
  return attrs.join("; ");
}
