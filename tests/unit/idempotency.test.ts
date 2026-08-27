// docs/AUDIT.md §5 item 8: "No idempotency keys on deal creation, dispute
// creation, or match interest — a retried POST creates a duplicate
// deal/dispute record." Proves withIdempotency() actually prevents that —
// against a real D1-backed test database (no mocks), matching the
// project's existing convention (see current-user.test.ts).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../../db";
import { idempotencyKeys, users } from "../../db/schema";
import { withIdempotency } from "../../lib/idempotency";
import type { SessionUser } from "../../lib/auth/current-user";

function sessionUser(id: number, email: string): SessionUser {
  return { id, email, displayName: "Test User", platformRole: null, status: "active", emailVerifiedAt: null };
}

async function makeUser(email: string) {
  const db = getDb();
  const [row] = await db.insert(users).values({ email, passwordHash: "pbkdf2$sha256$1$AA$AA", displayName: "Test User" }).returning({ id: users.id });
  return row.id;
}

function req(key?: string): Request {
  const headers = new Headers();
  if (key !== undefined) headers.set("idempotency-key", key);
  return new Request("http://localhost/api/deals", { method: "POST", headers });
}

describe("lib/idempotency withIdempotency", () => {
  beforeEach(async () => {
    const db = getDb();
    await db.delete(idempotencyKeys);
    await db.delete(users);
  });

  it("runs the handler and returns its response when no key is supplied", async () => {
    const userId = await makeUser("no-key@example.com");
    const handler = vi.fn(async () => Response.json({ ok: true }, { status: 201 }));
    const res = await withIdempotency(req(undefined), sessionUser(userId, "no-key@example.com"), "POST /api/deals", handler);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(201);
  });

  it("runs the handler once and stores the response for a fresh key", async () => {
    const userId = await makeUser("fresh-key@example.com");
    const handler = vi.fn(async () => Response.json({ deal: { id: 1 } }, { status: 201 }));
    const res = await withIdempotency(req("key-a"), sessionUser(userId, "fresh-key@example.com"), "POST /api/deals", handler);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(201);
    expect(await res.clone().json()).toEqual({ deal: { id: 1 } });
  });

  it("replays the stored response on a retry with the SAME key, without calling the handler again", async () => {
    const userId = await makeUser("retry@example.com");
    let created = 0;
    const handler = vi.fn(async () => {
      created += 1;
      return Response.json({ deal: { id: created } }, { status: 201 });
    });
    const first = await withIdempotency(req("same-key"), sessionUser(userId, "retry@example.com"), "POST /api/deals", handler);
    const second = await withIdempotency(req("same-key"), sessionUser(userId, "retry@example.com"), "POST /api/deals", handler);

    expect(handler).toHaveBeenCalledTimes(1); // the whole point: the second POST never re-ran the mutation
    expect(created).toBe(1); // only one "deal" was ever created
    expect(await first.clone().json()).toEqual(await second.clone().json());
    expect(second.headers.get("idempotency-replayed")).toBe("true");
  });

  it("does NOT replay across different keys — each is a genuinely separate action", async () => {
    const userId = await makeUser("distinct@example.com");
    let created = 0;
    const handler = vi.fn(async () => {
      created += 1;
      return Response.json({ deal: { id: created } }, { status: 201 });
    });
    await withIdempotency(req("key-1"), sessionUser(userId, "distinct@example.com"), "POST /api/deals", handler);
    await withIdempotency(req("key-2"), sessionUser(userId, "distinct@example.com"), "POST /api/deals", handler);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(created).toBe(2);
  });

  it("does NOT let one user's key collide with another user's identical key", async () => {
    const userA = await makeUser("a@example.com");
    const userB = await makeUser("b@example.com");
    let created = 0;
    const handler = vi.fn(async () => {
      created += 1;
      return Response.json({ deal: { id: created } }, { status: 201 });
    });
    await withIdempotency(req("shared-key"), sessionUser(userA, "a@example.com"), "POST /api/deals", handler);
    await withIdempotency(req("shared-key"), sessionUser(userB, "b@example.com"), "POST /api/deals", handler);

    expect(handler).toHaveBeenCalledTimes(2); // different users — not a replay, a second real action
  });

  it("does NOT cache a non-2xx response, so a genuinely failed attempt can be retried", async () => {
    const userId = await makeUser("failed@example.com");
    let attempts = 0;
    const handler = vi.fn(async () => {
      attempts += 1;
      return attempts === 1 ? Response.json({ error: "transient" }, { status: 500 }) : Response.json({ deal: { id: 1 } }, { status: 201 });
    });
    const first = await withIdempotency(req("retry-after-failure"), sessionUser(userId, "failed@example.com"), "POST /api/deals", handler);
    expect(first.status).toBe(500);
    const second = await withIdempotency(req("retry-after-failure"), sessionUser(userId, "failed@example.com"), "POST /api/deals", handler);
    expect(second.status).toBe(201); // the retry actually ran, because the failed attempt was never cached
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("collapses truly concurrent requests with the same key into a single mutation (regression: the initial select-then-insert implementation raced and let 3 concurrent requests each create their own record)", async () => {
    const userId = await makeUser("concurrent@example.com");
    let created = 0;
    const handler = vi.fn(async () => {
      // Simulate real mutation work with an await gap, which is exactly
      // what let the original select-then-insert implementation race:
      // all three requests could pass the "does a row exist?" check
      // before any of them finished writing.
      await new Promise((resolve) => setTimeout(resolve, 20));
      created += 1;
      return Response.json({ deal: { id: created } }, { status: 201 });
    });

    const results = await Promise.all(
      [1, 2, 3].map(() => withIdempotency(req("race-key"), sessionUser(userId, "concurrent@example.com"), "POST /api/deals", handler)),
    );

    expect(handler).toHaveBeenCalledTimes(1); // only the winner of the claim race actually ran the mutation
    expect(created).toBe(1);
    const bodies = await Promise.all(results.map((r) => r.clone().json() as Promise<{ deal: { id: number } }>));
    const ids = new Set(bodies.map((b) => b.deal.id));
    expect(ids.size).toBe(1); // every caller sees the SAME record, not three different ones
    expect(results.every((r) => r.status === 201)).toBe(true);
  });

  it("scopes the same key per-endpoint — POST /api/deals and POST /api/disputes never collide", async () => {
    const userId = await makeUser("multi-endpoint@example.com");
    const dealHandler = vi.fn(async () => Response.json({ deal: { id: 1 } }, { status: 201 }));
    const disputeHandler = vi.fn(async () => Response.json({ dispute: { id: 1 } }, { status: 201 }));
    await withIdempotency(req("one-key"), sessionUser(userId, "multi-endpoint@example.com"), "POST /api/deals", dealHandler);
    await withIdempotency(req("one-key"), sessionUser(userId, "multi-endpoint@example.com"), "POST /api/disputes", disputeHandler);

    expect(dealHandler).toHaveBeenCalledTimes(1);
    expect(disputeHandler).toHaveBeenCalledTimes(1);
  });
});
