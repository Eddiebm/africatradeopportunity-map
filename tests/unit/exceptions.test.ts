// Priority 8 (docs/production-readiness.md): the exception operations
// queue. Proves detection is driven by real rows (not fabricated),
// duplicate-open-row races are actually closed (same class of bug found
// once already for lib/idempotency.ts — see db/schema.ts's exceptions
// header), and auto-resolve actually clears a queue entry once its
// underlying condition is gone — against a real D1-backed test database.
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import {
  adminAuditEvents, deals, dealCosts, dealDocuments, dealEvents, dealParties, disputeEvents, disputes, exceptions,
  milestones, organizationMembers, organizations, organizationVerifications, sessions, users, verificationChecks,
} from "../../db/schema";
import { HIGH_VALUE_DEAL_USD, syncExceptionQueue } from "../../lib/exceptions";
import { recordOrganizationVerification } from "../../lib/verification-levels";
import { createSession, SESSION_COOKIE_NAME } from "../../lib/auth/session";
import { GET as exceptionsGet, PATCH as exceptionsPatch } from "../../app/api/admin/exceptions/route";
import { PATCH as scheduleMilestone } from "../../app/api/admin/milestones/[id]/schedule/route";

async function makeUser(email: string, platformRole: "administrator" | "verification_analyst" | null = null) {
  const db = getDb();
  const [row] = await db.insert(users).values({ email, passwordHash: "pbkdf2$sha256$1$AA$AA", displayName: "Test", platformRole }).returning({ id: users.id });
  return row.id;
}
async function makeDeal(overrides: Partial<typeof deals.$inferInsert> = {}) {
  const db = getDb();
  const [row] = await db.insert(deals).values({ reference: `DEAL-${crypto.randomUUID()}`, ownerEmail: "owner@example.com", requestType: "buy", product: "Rice", origin: "Ghana", destination: "Nigeria", stage: "request_confirmed", ...overrides }).returning();
  await db.insert(dealCosts).values({ dealId: row.id, supplierCost: 100 });
  return row;
}
async function makeOrg(ownerEmail = "org@example.com") {
  const db = getDb();
  const [row] = await db.insert(organizations).values({ ownerEmail, legalName: `Org ${crypto.randomUUID()}`, country: "Ghana" }).returning();
  return row;
}
function reqWithCookie(cookieValue: string | undefined, url: string, body?: unknown, method = "GET"): Request {
  const headers = new Headers();
  if (cookieValue) headers.set("cookie", `${SESSION_COOKIE_NAME}=${cookieValue}`);
  const init: RequestInit = { method: body ? "PATCH" : method, headers };
  if (body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(body);
  }
  return new Request(url, init);
}

describe("lib/exceptions syncExceptionQueue", () => {
  beforeEach(async () => {
    const db = getDb();
    await db.delete(exceptions);
    await db.delete(disputeEvents);
    await db.delete(disputes);
    await db.delete(dealEvents);
    await db.delete(dealParties);
    await db.delete(verificationChecks);
    await db.delete(dealDocuments);
    await db.delete(milestones);
    await db.delete(organizationVerifications);
    await db.delete(organizationMembers);
    await db.delete(dealCosts);
    await db.delete(deals);
    await db.delete(organizations);
    await db.delete(adminAuditEvents);
    await db.delete(sessions);
    await db.delete(users);
  });

  it("a failed verification check creates a real, deal-scoped open exception", async () => {
    const deal = await makeDeal();
    const db = getDb();
    await db.insert(verificationChecks).values({ dealId: deal.id, checkType: "identity", status: "failed" });
    const result = await syncExceptionQueue();
    expect(result.created).toBe(1);
    const rows = await db.select().from(exceptions).where(eq(exceptions.dealId, deal.id));
    expect(rows.length).toBe(1);
    expect(rows[0].exceptionType).toBe("failed_verification_check");
    expect(rows[0].severity).toBe("high");
    expect(rows[0].responsibleParty).toBe(deal.ownerEmail);
    expect(rows[0].status).toBe("open");
  });

  it("a passing verification check creates NO exception — never a fabricated signal", async () => {
    const deal = await makeDeal();
    await getDb().insert(verificationChecks).values({ dealId: deal.id, checkType: "identity", status: "verified" });
    const result = await syncExceptionQueue();
    expect(result.created).toBe(0);
  });

  it("DEDUPE: syncing twice for the same unchanged condition creates the row only once", async () => {
    const deal = await makeDeal();
    await getDb().insert(verificationChecks).values({ dealId: deal.id, checkType: "identity", status: "failed" });
    const first = await syncExceptionQueue();
    const second = await syncExceptionQueue();
    expect(first.created).toBe(1);
    expect(second.created).toBe(0); // already open — untouched, not duplicated
    const rows = await getDb().select().from(exceptions).where(eq(exceptions.dealId, deal.id));
    expect(rows.length).toBe(1);
  });

  it("RACE: concurrent syncs for the same new condition still produce exactly one row (regression class: idempotency-keys' original select-then-insert race)", async () => {
    const deal = await makeDeal();
    await getDb().insert(verificationChecks).values({ dealId: deal.id, checkType: "identity", status: "failed" });
    await Promise.all([syncExceptionQueue(), syncExceptionQueue(), syncExceptionQueue()]);
    const rows = await getDb().select().from(exceptions).where(eq(exceptions.dealId, deal.id));
    expect(rows.length).toBe(1);
  });

  it("AUTO-RESOLVE: once the underlying condition clears, the next sync resolves the exception with no human resolver", async () => {
    const deal = await makeDeal();
    const db = getDb();
    const [check] = await db.insert(verificationChecks).values({ dealId: deal.id, checkType: "identity", status: "failed" }).returning();
    await syncExceptionQueue();
    await db.update(verificationChecks).set({ status: "verified" }).where(eq(verificationChecks.id, check.id));
    const result = await syncExceptionQueue();
    expect(result.autoResolved).toBe(1);
    const [row] = await db.select().from(exceptions).where(eq(exceptions.dealId, deal.id));
    expect(row.status).toBe("resolved");
    expect(row.resolvedByEmail).toBe(""); // system, not a human — see db/schema.ts
    expect(row.openDedupeKey).toBeNull();
  });

  it("a recurrence AFTER resolution gets a fresh row, not the old one silently reopened", async () => {
    const deal = await makeDeal();
    const db = getDb();
    const [check] = await db.insert(verificationChecks).values({ dealId: deal.id, checkType: "identity", status: "failed" }).returning();
    await syncExceptionQueue();
    await db.update(verificationChecks).set({ status: "verified" }).where(eq(verificationChecks.id, check.id));
    await syncExceptionQueue(); // auto-resolves
    await db.update(verificationChecks).set({ status: "failed" }).where(eq(verificationChecks.id, check.id));
    await syncExceptionQueue(); // recurs
    const rows = await db.select().from(exceptions).where(eq(exceptions.dealId, deal.id));
    expect(rows.length).toBe(2); // full history preserved, not overwritten
    expect(rows.filter((r) => r.status === "open").length).toBe(1);
  });

  it("an overdue, unverified milestone with a real dueAt is flagged — a null dueAt never is", async () => {
    const deal = await makeDeal();
    const db = getDb();
    const past = new Date(Date.now() - 86400000).toISOString();
    await db.insert(milestones).values([
      { dealId: deal.id, sequence: 1, name: "Contract", releaseCondition: "x", dueAt: past, evidenceStatus: "missing" },
      { dealId: deal.id, sequence: 2, name: "No deadline set", releaseCondition: "x", dueAt: null, evidenceStatus: "missing" },
    ]);
    const result = await syncExceptionQueue();
    expect(result.created).toBe(1); // only the one with a real dueAt
    const [row] = await db.select().from(exceptions).where(eq(exceptions.dealId, deal.id));
    expect(row.exceptionType).toBe("overdue_milestone");
    expect(row.severity).toBe("high"); // evidence still missing
    expect(row.responsibleParty).toBe(deal.ownerEmail);
  });

  it("an overdue milestone with evidence already SUBMITTED is medium severity and owned by the review team, not the trader", async () => {
    const deal = await makeDeal();
    const db = getDb();
    await db.insert(milestones).values({ dealId: deal.id, sequence: 1, name: "Contract", releaseCondition: "x", dueAt: new Date(Date.now() - 1000).toISOString(), evidenceStatus: "submitted" });
    await syncExceptionQueue();
    const [row] = await db.select().from(exceptions).where(eq(exceptions.dealId, deal.id));
    expect(row.severity).toBe("medium");
    expect(row.responsibleParty).toBe("TradeSafe review team");
  });

  it("a high-value deal (>= HIGH_VALUE_DEAL_USD) is flagged high_value_deal", async () => {
    const deal = await makeDeal();
    await getDb().update(dealCosts).set({ supplierCost: HIGH_VALUE_DEAL_USD }).where(eq(dealCosts.dealId, deal.id));
    const result = await syncExceptionQueue();
    expect(result.created).toBe(1);
    const [row] = await getDb().select().from(exceptions).where(eq(exceptions.dealId, deal.id));
    expect(row.exceptionType).toBe("high_value_deal");
  });

  it("a small deal is NOT flagged high_value_deal", async () => {
    await makeDeal(); // default supplierCost: 100
    const result = await syncExceptionQueue();
    expect(result.created).toBe(0);
  });

  it("a real cross-priority integration: a deal already past counterparties_verified whose party's org verification has since dropped below level 1 is flagged CRITICAL", async () => {
    const org = await makeOrg();
    const deal = await makeDeal({ stage: "quotes_received" }); // already past counterparties_verified
    await getDb().insert(dealParties).values({ dealId: deal.id, organizationId: org.id, role: "supplier" });
    const result = await syncExceptionQueue();
    expect(result.created).toBeGreaterThanOrEqual(1);
    const rows = await getDb().select().from(exceptions).where(eq(exceptions.dealId, deal.id));
    const critical = rows.find((r) => r.severity === "critical");
    expect(critical?.exceptionType).toBe("verification_regression");
    expect(critical?.organizationId).toBe(org.id);

    // Now verify the org to level 1 and resync — the regression clears.
    await recordOrganizationVerification({ organizationId: org.id, levelKey: "identity", whatWasChecked: "x", performedByEmail: "a@example.com", source: "s", result: "passed", reviewerEmail: "r@example.com", humanReviewRequired: false });
    const second = await syncExceptionQueue();
    expect(second.autoResolved).toBeGreaterThanOrEqual(1);
    const after = await getDb().select().from(exceptions).where(eq(exceptions.dealId, deal.id));
    expect(after.some((r) => r.severity === "critical" && r.status === "open")).toBe(false);
  });

  it("a dispute past its real responseDueAt is flagged; one with no responseDueAt is not", async () => {
    const deal = await makeDeal();
    const db = getDb();
    const overdue = await db.insert(disputes).values({ reference: `DSP-${crypto.randomUUID()}`, dealId: deal.id, openedByEmail: deal.ownerEmail, category: "quality", description: "x".repeat(25), status: "open", priority: "urgent", responseDueAt: new Date(Date.now() - 1000).toISOString() }).returning();
    await db.insert(disputes).values({ reference: `DSP-${crypto.randomUUID()}`, dealId: deal.id, openedByEmail: deal.ownerEmail, category: "quality", description: "x".repeat(25), status: "open", priority: "normal" }); // no responseDueAt
    const result = await syncExceptionQueue();
    expect(result.created).toBe(1);
    const [row] = await db.select().from(exceptions).where(eq(exceptions.disputeId, overdue[0].id));
    expect(row.exceptionType).toBe("dispute_overdue");
    expect(row.severity).toBe("critical"); // priority: urgent
  });
});

describe("app/api/admin/exceptions route", () => {
  // Comprehensive on purpose, matching the first describe block's list —
  // this file's describes share one D1 instance across the whole run, so
  // a prior describe's leftover milestones/disputes/dealParties/dealEvents
  // rows (never cleaned up after that describe's LAST test, only before
  // its next one) would otherwise FK-block this describe's own `delete
  // from deals`. Confirmed live: an earlier, narrower version of this
  // beforeEach failed with exactly that FOREIGN KEY constraint error.
  beforeEach(async () => {
    const db = getDb();
    await db.delete(exceptions);
    await db.delete(disputeEvents);
    await db.delete(disputes);
    await db.delete(dealEvents);
    await db.delete(dealParties);
    await db.delete(verificationChecks);
    await db.delete(dealDocuments);
    await db.delete(milestones);
    await db.delete(organizationVerifications);
    await db.delete(organizationMembers);
    await db.delete(dealCosts);
    await db.delete(deals);
    await db.delete(organizations);
    await db.delete(adminAuditEvents);
    await db.delete(sessions);
    await db.delete(users);
  });

  it("GET requires a reviewer role", async () => {
    const userId = await makeUser("trader@example.com", null);
    const { cookieValue } = await createSession(userId, {});
    const res = await exceptionsGet(reqWithCookie(cookieValue, "http://localhost/api/admin/exceptions"));
    expect(res.status).toBe(403);
  });

  it("GET as a reviewer syncs and returns the queue, ranked with critical/open first", async () => {
    const adminId = await makeUser("admin@example.com", "administrator");
    const { cookieValue } = await createSession(adminId, {});
    const deal = await makeDeal();
    await getDb().insert(verificationChecks).values({ dealId: deal.id, checkType: "identity", status: "failed" });
    const res = await exceptionsGet(reqWithCookie(cookieValue, "http://localhost/api/admin/exceptions"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { exceptions: { id: number; status: string }[]; sync: { created: number } };
    expect(body.sync.created).toBe(1);
    expect(body.exceptions[0].status).toBe("open");
  });

  it("PATCH requires a reason on every action, matching every other admin-desk decision", async () => {
    const adminId = await makeUser("admin@example.com", "administrator");
    const { cookieValue } = await createSession(adminId, {});
    const deal = await makeDeal();
    await getDb().insert(verificationChecks).values({ dealId: deal.id, checkType: "identity", status: "failed" });
    await syncExceptionQueue();
    const [row] = await getDb().select().from(exceptions).where(eq(exceptions.dealId, deal.id));
    const res = await exceptionsPatch(reqWithCookie(cookieValue, "http://localhost/api/admin/exceptions", { id: row.id, action: "start" }));
    expect(res.status).toBe(400);
  });

  it("assign → start → resolve is a full, auditable lifecycle; resolve requires a resolutionSummary", async () => {
    const adminId = await makeUser("admin@example.com", "administrator");
    const { cookieValue } = await createSession(adminId, {});
    const deal = await makeDeal();
    await getDb().insert(verificationChecks).values({ dealId: deal.id, checkType: "identity", status: "failed" });
    await syncExceptionQueue();
    const [row] = await getDb().select().from(exceptions).where(eq(exceptions.dealId, deal.id));

    const assign = await exceptionsPatch(reqWithCookie(cookieValue, "http://localhost/api/admin/exceptions", { id: row.id, action: "assign", ownerEmail: "admin@example.com", reason: "taking this" }));
    expect(assign.status).toBe(200);
    const [afterAssign] = await getDb().select().from(exceptions).where(eq(exceptions.id, row.id));
    expect(afterAssign.ownerEmail).toBe("admin@example.com");
    expect(afterAssign.status).toBe("in_progress"); // auto-bumped from open

    const resolveNoSummary = await exceptionsPatch(reqWithCookie(cookieValue, "http://localhost/api/admin/exceptions", { id: row.id, action: "resolve", reason: "fixed it" }));
    expect(resolveNoSummary.status).toBe(400);

    const resolve = await exceptionsPatch(reqWithCookie(cookieValue, "http://localhost/api/admin/exceptions", { id: row.id, action: "resolve", reason: "fixed it", resolutionSummary: "Re-ran the identity check manually and it passed." }));
    expect(resolve.status).toBe(200);
    const [afterResolve] = await getDb().select().from(exceptions).where(eq(exceptions.id, row.id));
    expect(afterResolve.status).toBe("resolved");
    expect(afterResolve.resolvedByEmail).toBe("admin@example.com"); // a real human resolver, unlike auto-resolve
  });

  it("DISMISS: a dismissed exception is not immediately recreated by the next sync (the point of dismiss)", async () => {
    const adminId = await makeUser("admin@example.com", "administrator");
    const { cookieValue } = await createSession(adminId, {});
    const deal = await makeDeal();
    await getDb().insert(verificationChecks).values({ dealId: deal.id, checkType: "identity", status: "failed" });
    await syncExceptionQueue();
    const [row] = await getDb().select().from(exceptions).where(eq(exceptions.dealId, deal.id));

    const dismiss = await exceptionsPatch(reqWithCookie(cookieValue, "http://localhost/api/admin/exceptions", { id: row.id, action: "dismiss", reason: "known issue", resolutionSummary: "Accepted risk for this one deal." }));
    expect(dismiss.status).toBe(200);

    const result = await syncExceptionQueue(); // condition (failed check) still true
    expect(result.created).toBe(0); // NOT recreated — dismiss keeps the dedupe key claimed
    const rows = await getDb().select().from(exceptions).where(eq(exceptions.dealId, deal.id));
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("dismissed");
  });

  it("ATTACK: cannot resolve an already-resolved exception again (stale double-submit)", async () => {
    const adminId = await makeUser("admin@example.com", "administrator");
    const { cookieValue } = await createSession(adminId, {});
    const deal = await makeDeal();
    await getDb().insert(verificationChecks).values({ dealId: deal.id, checkType: "identity", status: "failed" });
    await syncExceptionQueue();
    const [row] = await getDb().select().from(exceptions).where(eq(exceptions.dealId, deal.id));
    await exceptionsPatch(reqWithCookie(cookieValue, "http://localhost/api/admin/exceptions", { id: row.id, action: "resolve", reason: "x", resolutionSummary: "y" }));
    const again = await exceptionsPatch(reqWithCookie(cookieValue, "http://localhost/api/admin/exceptions", { id: row.id, action: "resolve", reason: "x", resolutionSummary: "y" }));
    expect(again.status).toBe(409);
  });

  it("ATTACK: a non-reviewer cannot PATCH an exception directly", async () => {
    const userId = await makeUser("trader2@example.com", null);
    const { cookieValue } = await createSession(userId, {});
    const res = await exceptionsPatch(reqWithCookie(cookieValue, "http://localhost/api/admin/exceptions", { id: 1, action: "resolve", reason: "x", resolutionSummary: "y" }));
    expect(res.status).toBe(403);
  });
});

describe("app/api/admin/milestones/[id]/schedule route", () => {
  beforeEach(async () => {
    const db = getDb();
    await db.delete(exceptions);
    await db.delete(disputeEvents);
    await db.delete(disputes);
    await db.delete(dealEvents);
    await db.delete(dealParties);
    await db.delete(verificationChecks);
    await db.delete(dealDocuments);
    await db.delete(milestones);
    await db.delete(organizationVerifications);
    await db.delete(organizationMembers);
    await db.delete(dealCosts);
    await db.delete(deals);
    await db.delete(organizations);
    await db.delete(adminAuditEvents);
    await db.delete(sessions);
    await db.delete(users);
  });

  it("requires a reviewer role", async () => {
    const userId = await makeUser("trader3@example.com", null);
    const { cookieValue } = await createSession(userId, {});
    const deal = await makeDeal();
    const [m] = await getDb().insert(milestones).values({ dealId: deal.id, sequence: 1, name: "Contract", releaseCondition: "x" }).returning();
    const res = await scheduleMilestone(reqWithCookie(cookieValue, "http://localhost", { dueAt: "2030-01-01", reason: "x" }), { params: Promise.resolve({ id: String(m.id) }) });
    expect(res.status).toBe(403);
  });

  it("a reviewer can set and clear a milestone's dueAt, each requiring a reason", async () => {
    const adminId = await makeUser("admin4@example.com", "administrator");
    const { cookieValue } = await createSession(adminId, {});
    const deal = await makeDeal();
    const [m] = await getDb().insert(milestones).values({ dealId: deal.id, sequence: 1, name: "Contract", releaseCondition: "x" }).returning();

    const noReason = await scheduleMilestone(reqWithCookie(cookieValue, "http://localhost", { dueAt: "2030-01-01" }), { params: Promise.resolve({ id: String(m.id) }) });
    expect(noReason.status).toBe(400);

    const set = await scheduleMilestone(reqWithCookie(cookieValue, "http://localhost", { dueAt: "2030-01-01", reason: "buyer confirmed timeline" }), { params: Promise.resolve({ id: String(m.id) }) });
    expect(set.status).toBe(200);
    const [after] = await getDb().select().from(milestones).where(eq(milestones.id, m.id));
    expect(after.dueAt).toBe(new Date("2030-01-01").toISOString());
  });

  it("rejects an invalid due date", async () => {
    const adminId = await makeUser("admin5@example.com", "administrator");
    const { cookieValue } = await createSession(adminId, {});
    const deal = await makeDeal();
    const [m] = await getDb().insert(milestones).values({ dealId: deal.id, sequence: 1, name: "Contract", releaseCondition: "x" }).returning();
    const res = await scheduleMilestone(reqWithCookie(cookieValue, "http://localhost", { dueAt: "not-a-date", reason: "x" }), { params: Promise.resolve({ id: String(m.id) }) });
    expect(res.status).toBe(400);
  });
});
