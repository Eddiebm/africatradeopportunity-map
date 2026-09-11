// The project's first authorization test (docs/AUDIT.md §8): proves
// requireUserOrResponse / requirePlatformRoleOrResponse actually gate
// Route Handler access by cookie + platform role, against real Request
// objects and a real D1-backed session (not a mock).
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../../db";
import { sessions, users } from "../../db/schema";
import { requirePlatformRoleOrResponse, requireUserOrResponse } from "../../lib/auth/current-user";
import { createSession, SESSION_COOKIE_NAME } from "../../lib/auth/session";

function requestWithCookie(cookieValue?: string): Request {
  const headers = new Headers();
  if (cookieValue !== undefined) headers.set("cookie", `${SESSION_COOKIE_NAME}=${cookieValue}`);
  return new Request("http://localhost/api/admin/desk", { headers });
}

async function makeUser(email: string, platformRole: "administrator" | "verification_analyst" | null = null) {
  const db = getDb();
  const [row] = await db
    .insert(users)
    .values({ email, passwordHash: "pbkdf2$sha256$1$AA$AA", displayName: "Test User", platformRole })
    .returning({ id: users.id });
  return row.id;
}

describe("lib/auth/current-user authorization guards", () => {
  beforeEach(async () => {
    const db = getDb();
    await db.delete(sessions);
    await db.delete(users);
  });

  describe("requireUserOrResponse", () => {
    it("returns 401 when there is no cookie at all", async () => {
      const result = await requireUserOrResponse(requestWithCookie(undefined));
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(401);
    });

    it("returns 401 for a garbage/forged cookie", async () => {
      const result = await requireUserOrResponse(requestWithCookie("garbage.notarealsignature"));
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(401);
    });

    it("returns the SessionUser (not a Response) for a valid signed-in cookie", async () => {
      const userId = await makeUser("plain-user@example.com");
      const { cookieValue } = await createSession(userId, {});

      const result = await requireUserOrResponse(requestWithCookie(cookieValue));

      expect(result).not.toBeInstanceOf(Response);
      const user = result as Exclude<typeof result, Response>;
      expect(user.id).toBe(userId);
      expect(user.email).toBe("plain-user@example.com");
    });
  });

  describe("requirePlatformRoleOrResponse", () => {
    it("returns 401 when signed out", async () => {
      const result = await requirePlatformRoleOrResponse(requestWithCookie(undefined), ["administrator"]);
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(401);
    });

    it("returns 403 when signed in but lacking the required platform role", async () => {
      const userId = await makeUser("no-role@example.com", null);
      const { cookieValue } = await createSession(userId, {});

      const result = await requirePlatformRoleOrResponse(requestWithCookie(cookieValue), ["administrator"]);

      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(403);
    });

    it("returns 403 when signed in with a different, insufficient platform role", async () => {
      const userId = await makeUser("analyst@example.com", "verification_analyst");
      const { cookieValue } = await createSession(userId, {});

      const result = await requirePlatformRoleOrResponse(requestWithCookie(cookieValue), ["administrator"]);

      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(403);
    });

    it("returns the SessionUser (not a Response) when the role matches", async () => {
      const userId = await makeUser("admin@example.com", "administrator");
      const { cookieValue } = await createSession(userId, {});

      const result = await requirePlatformRoleOrResponse(requestWithCookie(cookieValue), ["administrator"]);

      expect(result).not.toBeInstanceOf(Response);
      const user = result as Exclude<typeof result, Response>;
      expect(user.id).toBe(userId);
      expect(user.platformRole).toBe("administrator");
    });
  });

  it("resolves the session strictly via the cookie header, ignoring any client-supplied identity fields", async () => {
    // Regression guard for docs/AUDIT.md §5.1: nothing about identity may be
    // trusted from request body/query/other headers — only the signed cookie.
    const userId = await makeUser("real-user@example.com");
    const { cookieValue } = await createSession(userId, {});

    const headers = new Headers();
    headers.set("cookie", `${SESSION_COOKIE_NAME}=${cookieValue}`);
    headers.set("x-user-email", "attacker@example.com"); // must be ignored
    const request = new Request("http://localhost/api/deals", { headers });

    const result = await requireUserOrResponse(request);
    expect(result).not.toBeInstanceOf(Response);
    expect((result as Exclude<typeof result, Response>).email).toBe("real-user@example.com");
  });
});
