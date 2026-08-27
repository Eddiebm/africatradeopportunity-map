// Priority 6 (docs/production-readiness.md): risk-based verification
// levels + the recommendation rules engine.
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../../db";
import { organizations, organizationVerifications, sessions, users } from "../../db/schema";
import { recordOrganizationVerification, recommendVerificationLevel, resolveOrganizationVerificationLevel } from "../../lib/verification-levels";
import { createSession, SESSION_COOKIE_NAME } from "../../lib/auth/session";
import { GET as levelGet } from "../../app/api/organizations/[id]/verification-level/route";
import { GET as adminGet, POST as adminPost } from "../../app/api/admin/organization-verifications/route";
import { POST as recommendationPost } from "../../app/api/admin/verification-recommendation/route";

async function makeUser(email: string, platformRole: "administrator" | "verification_analyst" | null = null) {
  const db = getDb();
  const [row] = await db.insert(users).values({ email, passwordHash: "pbkdf2$sha256$1$AA$AA", displayName: "Test", platformRole }).returning({ id: users.id });
  return row.id;
}
async function makeOrg() {
  const db = getDb();
  const [row] = await db.insert(organizations).values({ ownerEmail: "org@example.com", legalName: `Org ${crypto.randomUUID()}`, country: "Ghana" }).returning({ id: organizations.id });
  return row.id;
}
function reqWithCookie(cookieValue: string | undefined, url: string, body?: unknown): Request {
  const headers = new Headers();
  if (cookieValue) headers.set("cookie", `${SESSION_COOKIE_NAME}=${cookieValue}`);
  const init: RequestInit = { method: body ? "POST" : "GET", headers };
  if (body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(body);
  }
  return new Request(url, init);
}

describe("lib/verification-levels resolveOrganizationVerificationLevel", () => {
  beforeEach(async () => {
    const db = getDb();
    await db.delete(organizationVerifications);
    await db.delete(organizations);
  });

  it("an org with no rows is level 0", async () => {
    const orgId = await makeOrg();
    const { level } = await resolveOrganizationVerificationLevel(orgId);
    expect(level).toBe(0);
  });

  it("a single passed, human-reviewed level-1 fact makes the org level 1", async () => {
    const orgId = await makeOrg();
    await recordOrganizationVerification({
      organizationId: orgId, levelKey: "identity", whatWasChecked: "Passport check", performedByEmail: "a@example.com",
      source: "Government ID database", result: "passed", reviewerEmail: "reviewer@example.com", humanReviewRequired: false,
    });
    const { level, achievedKeys } = await resolveOrganizationVerificationLevel(orgId);
    expect(level).toBe(1);
    expect(achievedKeys).toEqual(["identity"]);
  });

  it("a GAP in the progression caps the level — passing level 1 and 3 but not 2 stays at level 1", async () => {
    const orgId = await makeOrg();
    const common = { organizationId: orgId, whatWasChecked: "x", performedByEmail: "a@example.com", source: "s", result: "passed" as const, reviewerEmail: "r@example.com", humanReviewRequired: false };
    await recordOrganizationVerification({ ...common, levelKey: "identity" });
    await recordOrganizationVerification({ ...common, levelKey: "address_bank_ownership" }); // level 3, skipping level 2
    const { level } = await resolveOrganizationVerificationLevel(orgId);
    expect(level).toBe(1); // NOT 3 — the gap at level 2 blocks credit for level 3
  });

  it("humanReviewRequired:true (AI-only / not yet human-confirmed) never counts toward the level", async () => {
    const orgId = await makeOrg();
    await recordOrganizationVerification({
      organizationId: orgId, levelKey: "identity", whatWasChecked: "AI-flagged document match", performedByEmail: "a@example.com",
      source: "automated extraction", result: "passed", reviewerEmail: "", humanReviewRequired: true,
    });
    const { level } = await resolveOrganizationVerificationLevel(orgId);
    expect(level).toBe(0); // AI-assisted result alone never finalizes a verification
  });

  it("an expired fact no longer counts", async () => {
    const orgId = await makeOrg();
    await recordOrganizationVerification({
      organizationId: orgId, levelKey: "identity", whatWasChecked: "x", performedByEmail: "a@example.com",
      source: "s", result: "passed", reviewerEmail: "r@example.com", humanReviewRequired: false,
      expiresAt: "2020-01-01T00:00:00.000Z", // long past
    });
    const { level } = await resolveOrganizationVerificationLevel(orgId);
    expect(level).toBe(0);
  });

  it("a re-check inserts a NEW row rather than mutating the old one — full history preserved", async () => {
    const orgId = await makeOrg();
    const common = { organizationId: orgId, levelKey: "identity" as const, whatWasChecked: "x", performedByEmail: "a@example.com", source: "s", reviewerEmail: "r@example.com", humanReviewRequired: false };
    await recordOrganizationVerification({ ...common, result: "failed" });
    await recordOrganizationVerification({ ...common, result: "passed" });
    const all = await getDb().select().from(organizationVerifications);
    expect(all.filter((r) => r.organizationId === orgId).length).toBe(2); // both rows exist — the failed attempt wasn't erased
    const { level } = await resolveOrganizationVerificationLevel(orgId);
    expect(level).toBe(1); // current state (passed) is what counts
  });
});

describe("lib/verification-levels recommendVerificationLevel", () => {
  it("a small, low-risk, repeat, on-delivery transaction recommends level 1", () => {
    const rec = recommendVerificationLevel({
      transactionValueUsd: 1000, corridorTier: "verified", productRisk: "low",
      isFirstTimeRelationship: false, priorDisputeCount: 0, paymentTerms: "on_delivery", evidenceQuality: "high",
    });
    expect(rec.recommendedLevel).toBe(1);
  });

  it("a large, high-risk, first-time, advance-payment transaction recommends a much higher level, capped at 6", () => {
    const rec = recommendVerificationLevel({
      transactionValueUsd: 500_000, corridorTier: "intelligence", productRisk: "high",
      isFirstTimeRelationship: true, priorDisputeCount: 3, paymentTerms: "advance", evidenceQuality: "low",
    });
    expect(rec.recommendedLevel).toBe(6); // sum would exceed 6; capped
    expect(rec.breakdown.length).toBeGreaterThan(1);
  });

  it("every factor in the breakdown has a stated reason — this is decision support, not a black box", () => {
    const rec = recommendVerificationLevel({
      transactionValueUsd: 100_000, corridorTier: "operational", productRisk: "medium",
      isFirstTimeRelationship: true, priorDisputeCount: 0, paymentTerms: "net_terms", evidenceQuality: "medium",
    });
    for (const b of rec.breakdown) {
      expect(b.reason.length).toBeGreaterThan(0);
    }
    expect(rec.policyNote).toMatch(/own risk policy|not a regulatory/i); // never claims external authority
  });
});

describe("app/api/organizations/[id]/verification-level (public)", () => {
  beforeEach(async () => {
    const db = getDb();
    await db.delete(organizationVerifications);
    await db.delete(organizations);
  });

  it("is unauthenticated and returns level 0 with no evidence detail for an org with no checks", async () => {
    const orgId = await makeOrg();
    const res = await levelGet(new Request("http://localhost"), { params: Promise.resolve({ id: String(orgId) }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { level: number; achievedLevels: string[] };
    expect(body.level).toBe(0);
    expect(body.achievedLevels).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("reviewerEmail"); // no internal detail leaked
  });

  it("returns 404 for a nonexistent organization", async () => {
    const res = await levelGet(new Request("http://localhost"), { params: Promise.resolve({ id: "999999" }) });
    expect(res.status).toBe(404);
  });
});

describe("app/api/admin/organization-verifications route", () => {
  beforeEach(async () => {
    const db = getDb();
    await db.delete(organizationVerifications);
    await db.delete(organizations);
    await db.delete(sessions);
    await db.delete(users);
  });

  it("requires a reviewer role — a plain signed-in user is forbidden", async () => {
    const userId = await makeUser("trader@example.com", null);
    const { cookieValue } = await createSession(userId, {});
    const orgId = await makeOrg();
    const res = await adminPost(reqWithCookie(cookieValue, "http://localhost", { organizationId: orgId, levelKey: "identity", result: "passed", humanReviewRequired: false, source: "s", reviewerEmail: "r@example.com" }));
    expect(res.status).toBe(403);
  });

  it("rejects humanReviewRequired:false + result:passed without a real source/reviewerEmail — no fabricated verification", async () => {
    const adminId = await makeUser("admin@example.com", "administrator");
    const { cookieValue } = await createSession(adminId, {});
    const orgId = await makeOrg();
    const res = await adminPost(reqWithCookie(cookieValue, "http://localhost", { organizationId: orgId, levelKey: "identity", result: "passed", humanReviewRequired: false }));
    expect(res.status).toBe(400);
  });

  it("rejects an invalid levelKey", async () => {
    const adminId = await makeUser("admin@example.com", "administrator");
    const { cookieValue } = await createSession(adminId, {});
    const orgId = await makeOrg();
    const res = await adminPost(reqWithCookie(cookieValue, "http://localhost", { organizationId: orgId, levelKey: "not_a_real_level", result: "passed" }));
    expect(res.status).toBe(400);
  });

  it("a verification_analyst (not just administrator) can record a verification", async () => {
    const analystId = await makeUser("analyst@example.com", "verification_analyst");
    const { cookieValue } = await createSession(analystId, {});
    const orgId = await makeOrg();
    const res = await adminPost(reqWithCookie(cookieValue, "http://localhost", { organizationId: orgId, levelKey: "identity", result: "passed", humanReviewRequired: false, source: "Real ID check", reviewerEmail: "analyst@example.com" }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { currentLevel: number };
    expect(body.currentLevel).toBe(1);
  });

  it("GET requires organizationId and returns full history for a reviewer", async () => {
    const adminId = await makeUser("admin@example.com", "administrator");
    const { cookieValue } = await createSession(adminId, {});
    const orgId = await makeOrg();
    const missing = await adminGet(reqWithCookie(cookieValue, "http://localhost/api/admin/organization-verifications"));
    expect(missing.status).toBe(400);
    const withId = await adminGet(reqWithCookie(cookieValue, `http://localhost/api/admin/organization-verifications?organizationId=${orgId}`));
    expect(withId.status).toBe(200);
  });
});

describe("app/api/admin/verification-recommendation route", () => {
  beforeEach(async () => {
    const db = getDb();
    await db.delete(sessions);
    await db.delete(users);
  });

  it("requires a reviewer role", async () => {
    const userId = await makeUser("trader2@example.com", null);
    const { cookieValue } = await createSession(userId, {});
    const res = await recommendationPost(reqWithCookie(cookieValue, "http://localhost", { transactionValueUsd: 1000 }));
    expect(res.status).toBe(403);
  });

  it("returns a real recommendation with a breakdown for a valid request", async () => {
    const adminId = await makeUser("admin2@example.com", "administrator");
    const { cookieValue } = await createSession(adminId, {});
    const res = await recommendationPost(reqWithCookie(cookieValue, "http://localhost", {
      transactionValueUsd: 60000, corridorTier: "operational", productRisk: "medium",
      isFirstTimeRelationship: true, priorDisputeCount: 0, paymentTerms: "net_terms", evidenceQuality: "medium",
    }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recommendedLevel: number };
    expect(body.recommendedLevel).toBeGreaterThanOrEqual(1);
  });

  it("rejects an invalid enum value", async () => {
    const adminId = await makeUser("admin3@example.com", "administrator");
    const { cookieValue } = await createSession(adminId, {});
    const res = await recommendationPost(reqWithCookie(cookieValue, "http://localhost", { productRisk: "not_a_real_risk" }));
    expect(res.status).toBe(400);
  });
});
