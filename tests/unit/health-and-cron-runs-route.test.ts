// Priority 3 (docs/production-readiness.md): health endpoint (public,
// minimal) and admin-only cron-run visibility, against real D1.
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../../db";
import { cronRuns, sessions, users } from "../../db/schema";
import { createSession, SESSION_COOKIE_NAME } from "../../lib/auth/session";
import { GET as healthGet } from "../../app/api/health/route";
import { GET as cronRunsGet } from "../../app/api/admin/cron-runs/route";

function reqWithCookie(cookieValue?: string): Request {
  const headers = new Headers();
  if (cookieValue) headers.set("cookie", `${SESSION_COOKIE_NAME}=${cookieValue}`);
  return new Request("http://localhost/api/admin/cron-runs", { headers });
}

async function makeUser(email: string, platformRole: "administrator" | "verification_analyst" | null = null) {
  const db = getDb();
  const [row] = await db.insert(users).values({ email, passwordHash: "pbkdf2$sha256$1$AA$AA", displayName: "Test", platformRole }).returning({ id: users.id });
  return row.id;
}

describe("GET /api/health", () => {
  it("returns 200 ok with a database check, unauthenticated", async () => {
    const res = await healthGet();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; checks: { database: string } };
    expect(body.status).toBe("ok");
    expect(body.checks.database).toBe("ok");
  });
});

describe("GET /api/admin/cron-runs", () => {
  beforeEach(async () => {
    const db = getDb();
    await db.delete(cronRuns);
    await db.delete(sessions);
    await db.delete(users);
  });

  it("requires authentication", async () => {
    const res = await cronRunsGet(reqWithCookie(undefined));
    expect(res.status).toBe(401);
  });

  it("requires administrator — a signed-in non-admin is forbidden", async () => {
    const userId = await makeUser("trader@example.com", null);
    const { cookieValue } = await createSession(userId, {});
    const res = await cronRunsGet(reqWithCookie(cookieValue));
    expect(res.status).toBe(403);
  });

  it("an administrator sees recent cron runs, newest first", async () => {
    const db = getDb();
    await db.insert(cronRuns).values([
      { jobName: "intelligence-watchlist-refresh", startedAt: "2026-01-01T00:00:00Z", status: "success", finishedAt: "2026-01-01T00:00:05Z", refreshedCount: 5, failedCount: 0 },
      { jobName: "intelligence-watchlist-refresh", startedAt: "2026-01-02T00:00:00Z", status: "failed", finishedAt: "2026-01-02T00:00:02Z", errorMessage: "network policy blocked" },
    ]);
    const adminId = await makeUser("admin@example.com", "administrator");
    const { cookieValue } = await createSession(adminId, {});
    const res = await cronRunsGet(reqWithCookie(cookieValue));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: { status: string }[] };
    expect(body.runs.length).toBe(2);
    expect(body.runs[0].status).toBe("failed"); // newest (id 2) first
  });
});
