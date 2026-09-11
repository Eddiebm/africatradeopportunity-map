// Proof case for the Workers pool: exercises real D1 (migrated schema, see
// apply-migrations.ts) and env.SESSION_SECRET inside Miniflare.
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../../db";
import { sessions, users } from "../../db/schema";
import { createSession, resolveSession, revokeSessionByCookie } from "../../lib/auth/session";

async function makeUser(email: string) {
  const db = getDb();
  const [row] = await db
    .insert(users)
    .values({ email, passwordHash: "pbkdf2$sha256$1$AA$AA", displayName: "Test User" })
    .returning({ id: users.id });
  return row.id;
}

describe("lib/auth/session", () => {
  beforeEach(async () => {
    const db = getDb();
    await db.delete(sessions);
    await db.delete(users);
  });

  it("creates a session and resolves it back to the owning user", async () => {
    const userId = await makeUser("session-ok@example.com");
    const { cookieValue } = await createSession(userId, { ip: "127.0.0.1", userAgent: "vitest" });

    const resolved = await resolveSession(cookieValue);

    expect(resolved).not.toBeNull();
    expect(resolved?.id).toBe(userId);
    expect(resolved?.email).toBe("session-ok@example.com");
  });

  it("returns null for a missing or malformed cookie", async () => {
    expect(await resolveSession(null)).toBeNull();
    expect(await resolveSession(undefined)).toBeNull();
    expect(await resolveSession("not-a-valid-cookie-no-dot")).toBeNull();
  });

  it("returns null when the signature has been tampered with", async () => {
    const userId = await makeUser("session-tamper@example.com");
    const { cookieValue } = await createSession(userId, {});
    const dot = cookieValue.indexOf(".");
    const sessionId = cookieValue.slice(0, dot);
    const signature = cookieValue.slice(dot + 1);

    // Flip one hex character in the signature.
    const flippedChar = signature[0] === "0" ? "1" : "0";
    const tampered = `${sessionId}.${flippedChar}${signature.slice(1)}`;

    expect(await resolveSession(tampered)).toBeNull();
  });

  it("returns null for a revoked session", async () => {
    const userId = await makeUser("session-revoked@example.com");
    const { cookieValue } = await createSession(userId, {});
    await revokeSessionByCookie(cookieValue);

    expect(await resolveSession(cookieValue)).toBeNull();
  });

  it("returns null for an expired session even with a valid signature", async () => {
    const userId = await makeUser("session-expired@example.com");
    const { cookieValue } = await createSession(userId, {});
    const sessionId = cookieValue.slice(0, cookieValue.indexOf("."));

    await getDb()
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 60_000).toISOString() })
      .where(eq(sessions.id, sessionId));

    expect(await resolveSession(cookieValue)).toBeNull();
  });

  it("returns null for a session belonging to a non-active user", async () => {
    const userId = await makeUser("session-suspended@example.com");
    const { cookieValue } = await createSession(userId, {});
    await getDb().update(users).set({ status: "suspended" }).where(eq(users.id, userId));

    expect(await resolveSession(cookieValue)).toBeNull();
  });

  it("actually has a working D1 binding with the sessions/users schema migrated", async () => {
    expect(env.DB).toBeTruthy();
    const db = getDb();
    // Would throw if the `users` table didn't exist (empty/unmigrated D1).
    const rows = await db.select().from(users);
    expect(Array.isArray(rows)).toBe(true);
  });
});
