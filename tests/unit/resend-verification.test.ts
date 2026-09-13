import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../../db";
import { emailVerificationTokens, sessions, users } from "../../db/schema";
import { createSession, SESSION_COOKIE_NAME } from "../../lib/auth/session";
import { POST as resendPost } from "../../app/api/auth/resend-verification/route";

async function makeUser(email: string) {
  const [row] = await getDb()
    .insert(users)
    .values({ email, passwordHash: "pbkdf2$sha256$1$AA$AA", displayName: "Test" })
    .returning();
  return row;
}

function req(cookieValue?: string): Request {
  const headers = new Headers();
  if (cookieValue) headers.set("cookie", `${SESSION_COOKIE_NAME}=${cookieValue}`);
  return new Request("http://localhost/api/auth/resend-verification", { method: "POST", headers });
}

describe("POST /api/auth/resend-verification", () => {
  beforeEach(async () => {
    const db = getDb();
    await db.delete(emailVerificationTokens);
    await db.delete(sessions);
    await db.delete(users);
  });

  it("requires sign-in", async () => {
    const res = await resendPost(req());
    expect(res.status).toBe(401);
  });

  it("honestly reports that the console provider did not deliver", async () => {
    const user = await makeUser("unverified@example.com");
    const { cookieValue } = await createSession(user.id, {});
    const res = await resendPost(req(cookieValue));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { email: { delivered: boolean; provider: string } };
    expect(body.email.delivered).toBe(false);
    expect(body.email.provider).toBe("console");
  });
});
