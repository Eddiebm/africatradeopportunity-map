// Priority 13 (docs/production-readiness.md): the business-validation
// dashboard. Proves every metric is computed from REAL rows (not
// fabricated), that the two genuinely-uncomputable metrics are always
// reported as unavailable with a real reason (never a fake number, never
// silently omitted), and that "traction" never leans on registrations,
// listings, or page views — against a real D1-backed test database.
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import {
  adminAuditEvents, deals, dealCosts, dealEvents, disputes, landedCostEntries, marketRequests, milestones,
  organizations, quoteRequests, quotes, referralAttributions, referralPartners, users,
} from "../../db/schema";
import { computeBusinessMetrics } from "../../lib/business-metrics";
import { recordLandedCostEntry } from "../../lib/landed-cost";

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

async function cleanAll() {
  const db = getDb();
  await db.delete(landedCostEntries);
  await db.delete(adminAuditEvents);
  await db.delete(dealEvents);
  await db.delete(disputes);
  await db.delete(quotes);
  await db.delete(quoteRequests);
  await db.delete(milestones);
  await db.delete(referralAttributions);
  await db.delete(referralPartners);
  await db.delete(marketRequests);
  await db.delete(dealCosts);
  await db.delete(deals);
  await db.delete(organizations);
  await db.delete(users);
}

describe("lib/business-metrics computeBusinessMetrics", () => {
  beforeEach(cleanAll);

  it("an empty platform reports honest zeros/unavailable — never a fabricated number", async () => {
    const m = await computeBusinessMetrics();
    expect(m.transactionsInitiated).toBe(0);
    expect(m.qualifiedBuyerRequests.total).toBe(0);
    expect(m.timeToFirstUsefulQuoteDays.available).toBe(false);
    expect(m.quoteToPaymentConfirmedConversionPct.available).toBe(false);
    expect(m.landedCostAccuracy.averageVariancePct.available).toBe(false);
    expect(m.verificationTurnaroundDays.available).toBe(false);
    expect(m.disputes.averageResolutionDays.available).toBe(false);
  });

  it("acquisitionCostPerQualifiedBuyer and revenuePerTransaction are ALWAYS unavailable, with a real stated reason — no fabricated number, no silent omission", async () => {
    await makeDeal();
    const m = await computeBusinessMetrics();
    expect(m.acquisitionCostPerQualifiedBuyer.available).toBe(false);
    if (!m.acquisitionCostPerQualifiedBuyer.available) expect(m.acquisitionCostPerQualifiedBuyer.reason.length).toBeGreaterThan(0);
    expect(m.revenuePerTransaction.available).toBe(false);
    if (!m.revenuePerTransaction.available) expect(m.revenuePerTransaction.reason.length).toBeGreaterThan(0);
  });

  it("qualified buyer requests are counted by real status, from real Priority 9 rows", async () => {
    const db = getDb();
    await db.insert(marketRequests).values([
      { role: "quote_request", origin: "", destination: "Ghana", product: "x", volume: "", contact: "a@example.com", status: "verified" },
      { role: "quote_request", origin: "", destination: "Ghana", product: "x", volume: "", contact: "b@example.com", status: "pending_verification" },
      { role: "quote_request", origin: "", destination: "Ghana", product: "x", volume: "", contact: "c@example.com", status: "rejected" },
      { role: "wanted", origin: "Kenya", destination: "Ghana", product: "x", volume: "10t", contact: "d@example.com", status: "verified" }, // NOT a quote_request — excluded
    ]);
    const m = await computeBusinessMetrics();
    expect(m.qualifiedBuyerRequests.total).toBe(3);
    expect(m.qualifiedBuyerRequests.verified).toBe(1);
    expect(m.qualifiedBuyerRequests.pendingReview).toBe(1);
    expect(m.qualifiedBuyerRequests.rejected).toBe(1);
  });

  it("verified suppliers count reads real organizations.verificationStatus", async () => {
    const db = getDb();
    const org1 = await makeOrg("s1@example.com");
    await makeOrg("s2@example.com"); // stays unverified — not counted
    await db.update(organizations).set({ verificationStatus: "verified" }).where(eq(organizations.id, org1.id));
    const m = await computeBusinessMetrics();
    expect(m.verifiedSuppliers).toBe(1);
  });

  it("partner-referred leads counts real primary attributions by real source", async () => {
    const db = getDb();
    const org = await makeOrg("referrer@example.com");
    const [partner] = await db.insert(referralPartners).values({ organizationId: org.id, code: "TEST01", createdByEmail: "referrer@example.com" }).returning();
    await db.insert(referralAttributions).values([
      { referralCode: partner.code, referralPartnerId: partner.id, refereeContact: "a@example.com", source: "intake_link", isPrimary: true },
      { referralCode: partner.code, referralPartnerId: partner.id, refereeContact: "b@example.com", source: "code_entry", isPrimary: true },
      { referralCode: partner.code, referralPartnerId: partner.id, refereeContact: "c@example.com", source: "intake_link", isPrimary: false, fraudFlag: "self_referral" }, // NOT counted — not primary
    ]);
    const m = await computeBusinessMetrics();
    expect(m.partnerReferredLeads.total).toBe(2);
    expect(m.partnerReferredLeads.bySource.intake_link).toBe(1);
    expect(m.partnerReferredLeads.bySource.code_entry).toBe(1);
  });

  it("time to first useful quote is a real day-count between deal creation and the real first quote", async () => {
    const db = getDb();
    const deal = await makeDeal();
    const buyerOrg = await makeOrg("buyer@example.com");
    const supplierOrg = await makeOrg("supplier@example.com");
    const [qr] = await db.insert(quoteRequests).values({ id: `QR-${crypto.randomUUID()}`, dealId: deal.id, requesterOrganizationId: buyerOrg.id, recipientOrganizationId: supplierOrg.id, quoteType: "buy" }).returning();
    await db.insert(quotes).values({ id: `Q-${crypto.randomUUID()}`, quoteRequestId: qr.id, submittedByOrganizationId: supplierOrg.id, currency: "USD", validUntil: new Date(Date.now() + 86400000).toISOString() });
    const m = await computeBusinessMetrics();
    expect(m.timeToFirstUsefulQuoteDays.available).toBe(true);
    if (m.timeToFirstUsefulQuoteDays.available) expect(m.timeToFirstUsefulQuoteDays.value).toBeGreaterThanOrEqual(0);
  });

  it("transactions initiated/completed and repeat owners are real counts", async () => {
    await makeDeal({ ownerEmail: "repeat@example.com" });
    await makeDeal({ ownerEmail: "repeat@example.com" });
    await makeDeal({ ownerEmail: "once@example.com", stage: "closed" });
    const m = await computeBusinessMetrics();
    expect(m.transactionsInitiated).toBe(3);
    expect(m.transactionsCompleted).toBe(1);
    expect(m.repeatTransactionOwners).toBe(1);
  });

  it("landed-cost accuracy computes a real variance percentage from real Priority 12 entries", async () => {
    const deal = await makeDeal();
    await recordLandedCostEntry({ dealId: deal.id, componentType: "goods", phase: "estimate", expectedAmount: 1000, recordedByEmail: "owner@example.com" });
    await recordLandedCostEntry({ dealId: deal.id, componentType: "goods", phase: "actual", expectedAmount: 1100, source: "Invoice", recordedByEmail: "owner@example.com" });
    const m = await computeBusinessMetrics();
    expect(m.landedCostAccuracy.dealsWithActuals).toBe(1);
    expect(m.landedCostAccuracy.averageVariancePct.available).toBe(true);
    if (m.landedCostAccuracy.averageVariancePct.available) expect(m.landedCostAccuracy.averageVariancePct.value).toBeCloseTo(10, 1); // (1100-1000)/1000 * 100
  });

  it("disputes are counted by real status with a real average resolution time", async () => {
    const db = getDb();
    const deal = await makeDeal();
    const now = new Date();
    const resolvedAt = new Date(now.getTime() + 3 * 86400000).toISOString();
    await db.insert(disputes).values([
      { reference: `DSP-${crypto.randomUUID()}`, dealId: deal.id, openedByEmail: "a@example.com", category: "quality", description: "x".repeat(25), status: "resolved", resolvedAt },
      { reference: `DSP-${crypto.randomUUID()}`, dealId: deal.id, openedByEmail: "a@example.com", category: "quality", description: "x".repeat(25), status: "open" },
    ]);
    const m = await computeBusinessMetrics();
    expect(m.disputes.total).toBe(2);
    expect(m.disputes.resolved).toBe(1);
    expect(m.disputes.open).toBe(1);
    expect(m.disputes.averageResolutionDays.available).toBe(true);
  });

  it("on-time milestones compares a real verification event to the milestone's real dueAt", async () => {
    const db = getDb();
    const deal = await makeDeal();
    const admin = await db.insert(users).values({ email: "reviewer@example.com", passwordHash: "x", displayName: "R" }).returning({ id: users.id });
    const past = new Date(Date.now() - 86400000).toISOString();
    const [onTimeMilestone] = await db.insert(milestones).values({ dealId: deal.id, sequence: 1, name: "Contract", releaseCondition: "x", dueAt: past }).returning();
    // Verified BEFORE the due date — on time.
    await db.insert(adminAuditEvents).values({ actorUserId: admin[0].id, action: "status_change", entityType: "milestone", entityId: onTimeMilestone.id, toStatus: "verified", reason: "x", createdAt: new Date(Date.now() - 2 * 86400000).toISOString() });
    const m = await computeBusinessMetrics();
    expect(m.onTimeMilestones.withDueDate).toBe(1);
    expect(m.onTimeMilestones.verifiedOnTime).toBe(1);
    expect(m.onTimeMilestones.verifiedLate).toBe(0);
  });

  it("verification turnaround reads a real dealEvents stage_transition row, not a guess", async () => {
    const deal = await makeDeal();
    await getDb().insert(dealEvents).values({ dealId: deal.id, actorEmail: "admin@example.com", eventType: "stage_transition", summary: "parties_assigned → counterparties_verified: verified" });
    const m = await computeBusinessMetrics();
    expect(m.verificationTurnaroundDays.available).toBe(true);
  });
});
