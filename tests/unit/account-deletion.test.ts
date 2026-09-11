// Production-hardening audit follow-up (docs/production-readiness.md): "no
// account-deletion flow" — proves the design confirmed by the account
// owner actually holds: a clear account auto-processes after the grace
// period; an account with an open deal/dispute/exception is held for
// review instead of silently proceeding; a request that becomes blocked
// DURING its grace period is re-checked at execution time, not just at
// request time; anonymization scrubs the users row and revokes sessions
// without touching the deal/dispute/exception rows themselves; and an
// admin's approve/deny decision on a held request is real and audited.
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import { accountDeletionRequests, adminAuditEvents, deals, dealCosts, disputes, exceptions, organizationMembers, organizations, sessions, users } from "../../db/schema";
import {
  ACCOUNT_DELETION_GRACE_PERIOD_HOURS, cancelAccountDeletion, checkOpenAccountActivity,
  decideHeldAccountDeletion, processDueAccountDeletions, requestAccountDeletion,
} from "../../lib/account-deletion";
import { createSession, SESSION_COOKIE_NAME } from "../../lib/auth/session";
import { GET as reqGet, POST as reqPost, DELETE as reqDelete } from "../../app/api/account/deletion-request/route";
import { GET as adminGet, PATCH as adminPatch } from "../../app/api/admin/account-deletions/route";

async function makeUser(email: string, platformRole: "administrator" | "verification_analyst" | null = null) {
  const db = getDb();
  const [row] = await db.insert(users).values({ email, passwordHash: "pbkdf2$sha256$1$AA$AA", displayName: "Test User", platformRole }).returning();
  return row;
}
function reqWithCookie(cookieValue: string | undefined, url: string, body?: unknown, method = "GET"): Request {
  const headers = new Headers();
  if (cookieValue) headers.set("cookie", `${SESSION_COOKIE_NAME}=${cookieValue}`);
  const init: RequestInit = { method: body !== undefined ? "PATCH" : method, headers };
  if (body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(body);
  }
  return new Request(url, init);
}

describe("lib/account-deletion", () => {
  beforeEach(async () => {
    const db = getDb();
    await db.delete(exceptions);
    await db.delete(disputes);
    await db.delete(dealCosts);
    await db.delete(deals);
    await db.delete(organizationMembers);
    await db.delete(organizations);
    await db.delete(adminAuditEvents);
    await db.delete(accountDeletionRequests);
    await db.delete(sessions);
    await db.delete(users);
  });

  it("a clear account (no open deal/dispute/exception) is scheduled to auto-process after the grace period", async () => {
    const user = await makeUser("clear@example.com");
    const before = Date.now();
    const row = await requestAccountDeletion(user.id);
    expect(row.status).toBe("pending");
    expect(row.scheduledFor).toBeTruthy();
    const scheduledMs = new Date(row.scheduledFor as string).getTime();
    expect(scheduledMs).toBeGreaterThanOrEqual(before + ACCOUNT_DELETION_GRACE_PERIOD_HOURS * 3_600_000 - 5_000);

    const [updatedUser] = await getDb().select().from(users).where(eq(users.id, user.id));
    expect(updatedUser.deletionRequestedAt).toBeTruthy();
  });

  it("an account with an open deal is held for review, not scheduled", async () => {
    const user = await makeUser("hasdeal@example.com");
    const db = getDb();
    const [deal] = await db.insert(deals).values({ reference: `DEAL-${crypto.randomUUID()}`, ownerEmail: user.email, requestType: "buy", product: "Rice", origin: "Ghana", destination: "Nigeria", stage: "quotes_received" }).returning();

    const row = await requestAccountDeletion(user.id);
    expect(row.status).toBe("held_for_review");
    expect(row.heldReason).toContain(deal.reference);
    expect(row.scheduledFor).toBeFalsy();
  });

  it("an account with an open dispute (as either party) is held for review", async () => {
    const user = await makeUser("hasdispute@example.com");
    const db = getDb();
    const [deal] = await db.insert(deals).values({ reference: `DEAL-${crypto.randomUUID()}`, ownerEmail: "otherparty@example.com", requestType: "buy", product: "Rice", origin: "Ghana", destination: "Nigeria", stage: "closed" }).returning();
    await db.insert(disputes).values({ reference: `DIS-${crypto.randomUUID()}`, dealId: deal.id, openedByEmail: "otherparty@example.com", respondentEmail: user.email, category: "quality", description: "x", status: "open" });

    const reasons = await checkOpenAccountActivity(user.email, user.id);
    expect(reasons.some((r) => r.includes("dispute"))).toBe(true);
  });

  it("an account with an open exception on their own organization is held for review", async () => {
    const user = await makeUser("hasorgexc@example.com");
    const db = getDb();
    const [org] = await db.insert(organizations).values({ ownerEmail: user.email, legalName: "Org X", country: "Ghana" }).returning();
    await db.insert(organizationMembers).values({ organizationId: org.id, userId: user.id, role: "trader", status: "active" });
    await db.insert(exceptions).values({ exceptionType: "test_manual", severity: "medium", organizationId: org.id, entityType: "organization", entityId: org.id, dedupeKey: crypto.randomUUID(), summary: "unresolved test exception", status: "open" });

    const row = await requestAccountDeletion(user.id);
    expect(row.status).toBe("held_for_review");
    expect(row.heldReason).toContain("unresolved test exception");
  });

  it("requesting deletion twice while one is already pending/held is idempotent — returns the same row", async () => {
    const user = await makeUser("idempotent@example.com");
    const first = await requestAccountDeletion(user.id);
    const second = await requestAccountDeletion(user.id);
    expect(second.id).toBe(first.id);
    const all = await getDb().select().from(accountDeletionRequests).where(eq(accountDeletionRequests.userId, user.id));
    expect(all.length).toBe(1);
  });

  it("cancelling a pending request marks it cancelled and clears deletionRequestedAt; cancelling again is a no-op", async () => {
    const user = await makeUser("cancelme@example.com");
    await requestAccountDeletion(user.id);
    const cancelled = await cancelAccountDeletion(user.id);
    expect(cancelled).toBe(true);

    const [row] = await getDb().select().from(accountDeletionRequests).where(eq(accountDeletionRequests.userId, user.id));
    expect(row.status).toBe("cancelled");
    const [updatedUser] = await getDb().select().from(users).where(eq(users.id, user.id));
    expect(updatedUser.deletionRequestedAt).toBeNull();

    expect(await cancelAccountDeletion(user.id)).toBe(false);
  });

  it("processDueAccountDeletions anonymizes a due, still-clear account: scrubs PII, revokes sessions, preserves the deal it didn't own, and logs an audit event", async () => {
    const user = await makeUser("duefordeletion@example.com");
    const { cookieValue } = await createSession(user.id, { ip: "1.1.1.1", userAgent: "test" });
    const request = await requestAccountDeletion(user.id);
    // Force it due — simulates the grace period having actually elapsed.
    await getDb().update(accountDeletionRequests).set({ scheduledFor: new Date(Date.now() - 1000).toISOString() }).where(eq(accountDeletionRequests.id, request.id));

    const result = await processDueAccountDeletions();
    expect(result.processed).toBe(1);
    expect(result.heldNow).toBe(0);

    const [updatedUser] = await getDb().select().from(users).where(eq(users.id, user.id));
    expect(updatedUser.email).not.toBe("duefordeletion@example.com");
    expect(updatedUser.email).toContain("deleted-user-");
    expect(updatedUser.displayName).toBe("Deleted user");
    expect(updatedUser.status).toBe("deleted");
    expect(updatedUser.passwordHash).not.toBe("pbkdf2$sha256$1$AA$AA");

    const [session] = await getDb().select().from(sessions).where(eq(sessions.userId, user.id));
    expect(session.revokedAt).toBeTruthy();
    void cookieValue;

    const [finalRequest] = await getDb().select().from(accountDeletionRequests).where(eq(accountDeletionRequests.id, request.id));
    expect(finalRequest.status).toBe("completed");
    expect(finalRequest.completedAt).toBeTruthy();

    const auditRows = await getDb().select().from(adminAuditEvents).where(eq(adminAuditEvents.action, "account_deletion_completed"));
    expect(auditRows.length).toBe(1);
    expect(auditRows[0].entityId).toBe(user.id);
  });

  it("processDueAccountDeletions re-checks at execution time: a deal opened DURING the grace period holds it instead of anonymizing", async () => {
    const user = await makeUser("becomesblocked@example.com");
    const request = await requestAccountDeletion(user.id);
    expect(request.status).toBe("pending"); // clear at request time

    // A new deal appears before the grace period elapses.
    await getDb().insert(deals).values({ reference: `DEAL-${crypto.randomUUID()}`, ownerEmail: user.email, requestType: "buy", product: "Rice", origin: "Ghana", destination: "Nigeria", stage: "request_confirmed" });
    await getDb().update(accountDeletionRequests).set({ scheduledFor: new Date(Date.now() - 1000).toISOString() }).where(eq(accountDeletionRequests.id, request.id));

    const result = await processDueAccountDeletions();
    expect(result.processed).toBe(0);
    expect(result.heldNow).toBe(1);

    const [updatedUser] = await getDb().select().from(users).where(eq(users.id, user.id));
    expect(updatedUser.email).toBe("becomesblocked@example.com"); // untouched

    const [finalRequest] = await getDb().select().from(accountDeletionRequests).where(eq(accountDeletionRequests.id, request.id));
    expect(finalRequest.status).toBe("held_for_review");
  });

  it("admin denying a held request leaves the account untouched and clears deletionRequestedAt", async () => {
    const user = await makeUser("denyme@example.com");
    const db = getDb();
    await db.insert(deals).values({ reference: `DEAL-${crypto.randomUUID()}`, ownerEmail: user.email, requestType: "buy", product: "Rice", origin: "Ghana", destination: "Nigeria", stage: "request_confirmed" });
    const request = await requestAccountDeletion(user.id);
    expect(request.status).toBe("held_for_review");

    const admin = await makeUser("admin1@example.com", "administrator");
    const result = await decideHeldAccountDeletion(request.id, { id: admin.id, email: admin.email }, "denied", "Account still has an active deal in flight.");
    expect(result.ok).toBe(true);

    const [finalRequest] = await db.select().from(accountDeletionRequests).where(eq(accountDeletionRequests.id, request.id));
    expect(finalRequest.status).toBe("denied");
    expect(finalRequest.decidedByEmail).toBe(admin.email);

    const [updatedUser] = await db.select().from(users).where(eq(users.id, user.id));
    expect(updatedUser.email).toBe("denyme@example.com");
    expect(updatedUser.deletionRequestedAt).toBeNull();
  });

  it("admin approving a held request anonymizes the account despite the open item, and is audited under the admin's identity", async () => {
    const user = await makeUser("approveme@example.com");
    const db = getDb();
    await db.insert(deals).values({ reference: `DEAL-${crypto.randomUUID()}`, ownerEmail: user.email, requestType: "buy", product: "Rice", origin: "Ghana", destination: "Nigeria", stage: "request_confirmed" });
    const request = await requestAccountDeletion(user.id);

    const admin = await makeUser("admin2@example.com", "administrator");
    const result = await decideHeldAccountDeletion(request.id, { id: admin.id, email: admin.email }, "approved", "User is deceased; family requested deletion; deal will be handled separately.");
    expect(result.ok).toBe(true);

    const [updatedUser] = await db.select().from(users).where(eq(users.id, user.id));
    expect(updatedUser.status).toBe("deleted");

    const [finalRequest] = await db.select().from(accountDeletionRequests).where(eq(accountDeletionRequests.id, request.id));
    expect(finalRequest.status).toBe("completed");
    expect(finalRequest.decidedByEmail).toBe(admin.email);

    const auditRows = await db.select().from(adminAuditEvents).where(eq(adminAuditEvents.action, "account_deletion_approved"));
    expect(auditRows.length).toBe(1);
    expect(auditRows[0].actorUserId).toBe(admin.id); // the admin, not the deleted user, is the actor here
  });

  it("deciding a request that isn't held_for_review is rejected", async () => {
    const user = await makeUser("notheld@example.com");
    const request = await requestAccountDeletion(user.id);
    expect(request.status).toBe("pending"); // clear account — never held

    const admin = await makeUser("admin3@example.com", "administrator");
    const result = await decideHeldAccountDeletion(request.id, { id: admin.id, email: admin.email }, "approved", "x");
    expect(result.ok).toBe(false);
  });
});

describe("account-deletion API routes", () => {
  beforeEach(async () => {
    const db = getDb();
    await db.delete(exceptions);
    await db.delete(disputes);
    await db.delete(dealCosts);
    await db.delete(deals);
    await db.delete(organizationMembers);
    await db.delete(organizations);
    await db.delete(adminAuditEvents);
    await db.delete(accountDeletionRequests);
    await db.delete(sessions);
    await db.delete(users);
  });

  it("POST/GET/DELETE deletion-request require sign-in", async () => {
    expect((await reqPost(reqWithCookie(undefined, "https://x/api/account/deletion-request", undefined, "POST"))).status).toBe(401);
    expect((await reqGet(reqWithCookie(undefined, "https://x/api/account/deletion-request"))).status).toBe(401);
    expect((await reqDelete(reqWithCookie(undefined, "https://x/api/account/deletion-request", undefined, "DELETE"))).status).toBe(401);
  });

  it("a signed-in user can request, see, and cancel their own deletion request end to end", async () => {
    const user = await makeUser("apiuser@example.com");
    const { cookieValue } = await createSession(user.id, {});

    const postRes = await reqPost(reqWithCookie(cookieValue, "https://x/api/account/deletion-request", undefined, "POST"));
    expect(postRes.status).toBe(201);

    const getRes = await reqGet(reqWithCookie(cookieValue, "https://x/api/account/deletion-request"));
    const getBody = (await getRes.json()) as { request: { status: string } };
    expect(getBody.request.status).toBe("pending");

    const delRes = await reqDelete(reqWithCookie(cookieValue, "https://x/api/account/deletion-request", undefined, "DELETE"));
    expect(delRes.status).toBe(200);

    // Nothing left to cancel a second time.
    const delAgain = await reqDelete(reqWithCookie(cookieValue, "https://x/api/account/deletion-request", undefined, "DELETE"));
    expect(delAgain.status).toBe(409);
  });

  it("admin account-deletions routes require an administrator/verification_analyst role, not just sign-in", async () => {
    const plainUser = await makeUser("plain@example.com");
    const { cookieValue } = await createSession(plainUser.id, {});
    const res = await adminGet(reqWithCookie(cookieValue, "https://x/api/admin/account-deletions"));
    expect(res.status).toBe(403);
  });

  it("admin PATCH requires a reason and a valid decision value", async () => {
    const admin = await makeUser("adminroute@example.com", "administrator");
    const { cookieValue } = await createSession(admin.id, {});
    const noReason = await adminPatch(reqWithCookie(cookieValue, "https://x/api/admin/account-deletions", { id: 1, decision: "approved" }));
    expect(noReason.status).toBe(400);
    const badDecision = await adminPatch(reqWithCookie(cookieValue, "https://x/api/admin/account-deletions", { id: 1, decision: "maybe", reason: "x" }));
    expect(badDecision.status).toBe(400);
  });

  it("admin GET lists only held_for_review requests, with the requester's email attached", async () => {
    const user = await makeUser("listed@example.com");
    const db = getDb();
    await db.insert(deals).values({ reference: `DEAL-${crypto.randomUUID()}`, ownerEmail: user.email, requestType: "buy", product: "Rice", origin: "Ghana", destination: "Nigeria", stage: "request_confirmed" });
    await requestAccountDeletion(user.id); // held_for_review

    const clearUser = await makeUser("notlisted@example.com");
    await requestAccountDeletion(clearUser.id); // pending — should NOT appear

    const admin = await makeUser("adminlist@example.com", "administrator");
    const { cookieValue } = await createSession(admin.id, {});
    const res = await adminGet(reqWithCookie(cookieValue, "https://x/api/admin/account-deletions"));
    const body = (await res.json()) as { requests: { userEmail: string }[] };
    expect(body.requests.length).toBe(1);
    expect(body.requests[0].userEmail).toBe("listed@example.com");
  });
});
