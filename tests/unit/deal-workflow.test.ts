// Priority 7 (docs/production-readiness.md): the deal state machine.
// Proves stage-skipping is actually blocked, preconditions are actually
// checked against real data, and role authorization is real — against a
// real D1-backed test database.
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import {
  deals, dealEvents, dealParties, milestones, organizationMembers, organizations, organizationVerifications,
  quotes, quoteRequests, users,
} from "../../db/schema";
import { attemptDealTransition, DEAL_STAGES, nextStage } from "../../lib/deal-workflow";
import { recordOrganizationVerification } from "../../lib/verification-levels";
import type { SessionUser } from "../../lib/auth/current-user";

function sessionUser(email: string, platformRole: SessionUser["platformRole"] = "administrator"): SessionUser {
  return { id: 1, email, displayName: "Test", platformRole, status: "active", emailVerifiedAt: null };
}

async function makeDeal() {
  const db = getDb();
  const [row] = await db.insert(deals).values({ reference: `DEAL-${crypto.randomUUID()}`, ownerEmail: "owner@example.com", requestType: "buy", product: "Rice", origin: "Ghana", destination: "Nigeria", stage: "request_confirmed" }).returning();
  return row.id;
}
async function makeOrg() {
  const db = getDb();
  const [row] = await db.insert(organizations).values({ ownerEmail: "org@example.com", legalName: `Org ${crypto.randomUUID()}`, country: "Ghana" }).returning({ id: organizations.id });
  return row.id;
}

describe("lib/deal-stages nextStage", () => {
  it("returns the next stage for every non-terminal stage, and null for the last", () => {
    for (let i = 0; i < DEAL_STAGES.length - 1; i++) {
      expect(nextStage(DEAL_STAGES[i])).toBe(DEAL_STAGES[i + 1]);
    }
    expect(nextStage("closed")).toBeNull();
  });

  it("returns null for an unrecognized/legacy stage value (e.g. the old 'intake')", () => {
    expect(nextStage("intake")).toBeNull();
    expect(nextStage("investigating")).toBeNull();
  });
});

describe("lib/deal-workflow attemptDealTransition", () => {
  beforeEach(async () => {
    const db = getDb();
    await db.delete(dealEvents);
    await db.delete(dealParties);
    await db.delete(organizationMembers);
    await db.delete(organizationVerifications);
    await db.delete(quotes);
    await db.delete(quoteRequests);
    await db.delete(milestones);
    await db.delete(organizations);
    await db.delete(deals);
    await db.delete(users);
  });

  it("STAGE SKIPPING IS BLOCKED — cannot jump from request_confirmed straight to closed", async () => {
    const dealId = await makeDeal();
    const result = await attemptDealTransition(dealId, "closed", sessionUser("admin@example.com"), "trying to skip");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/parties_assigned/); // names the ACTUAL legal next stage
    }
    const [deal] = await getDb().select().from(deals).where(eq(deals.id, dealId));
    expect(deal.stage).toBe("request_confirmed"); // unchanged
  });

  it("the legal next transition succeeds when its precondition is met, and writes a dealEvents row", async () => {
    const dealId = await makeDeal();
    const db = getDb();
    await db.insert(dealParties).values({ dealId, role: "supplier", contact: "s@example.com" });

    const result = await attemptDealTransition(dealId, "parties_assigned", sessionUser("admin@example.com"), "party assigned");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deal.stage).toBe("parties_assigned");
      expect(result.fromStage).toBe("request_confirmed");
    }
    const events = await db.select().from(dealEvents).where(eq(dealEvents.dealId, dealId));
    expect(events.some((e) => e.eventType === "stage_transition")).toBe(true);
  });

  it("a real precondition actually blocks the transition when unmet — parties_assigned requires a real deal_parties row", async () => {
    const dealId = await makeDeal();
    const result = await attemptDealTransition(dealId, "parties_assigned", sessionUser("admin@example.com"), "no parties yet");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/No parties/);
  });

  it("counterparties_verified requires the party's organization to have reached verification level 1 (real Priority 6 integration)", async () => {
    const dealId = await makeDeal();
    const db = getDb();
    const orgId = await makeOrg();
    await db.insert(dealParties).values({ dealId, organizationId: orgId, role: "supplier" });
    await attemptDealTransition(dealId, "parties_assigned", sessionUser("admin@example.com"), "assigned");

    const blocked = await attemptDealTransition(dealId, "counterparties_verified", sessionUser("admin@example.com"), "attempt");
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toMatch(/verification level 1/);

    // Now actually verify the org (level 1) and retry — should succeed.
    await recordOrganizationVerification({
      organizationId: orgId, levelKey: "identity", whatWasChecked: "x", performedByEmail: "a@example.com",
      source: "s", result: "passed", reviewerEmail: "r@example.com", humanReviewRequired: false,
    });
    const allowed = await attemptDealTransition(dealId, "counterparties_verified", sessionUser("admin@example.com"), "now verified");
    expect(allowed.ok).toBe(true);
  });

  it("quotes_received requires a real quote submitted for this deal", async () => {
    const dealId = await makeDeal();
    const db = getDb();
    await db.insert(dealParties).values({ dealId, role: "supplier", contact: "s@example.com" });
    await attemptDealTransition(dealId, "parties_assigned", sessionUser("admin@example.com"), "x");
    await attemptDealTransition(dealId, "counterparties_verified", sessionUser("admin@example.com"), "x"); // no org parties -> vacuously passes

    const blocked = await attemptDealTransition(dealId, "quotes_received", sessionUser("admin@example.com"), "attempt");
    expect(blocked.ok).toBe(false);

    const orgA = await makeOrg();
    const orgB = await makeOrg();
    const [qr] = await db.insert(quoteRequests).values({ id: `QR-${crypto.randomUUID()}`, dealId, requesterOrganizationId: orgA, recipientOrganizationId: orgB, quoteType: "buy" }).returning();
    await db.insert(quotes).values({ id: `Q-${crypto.randomUUID()}`, quoteRequestId: qr.id, submittedByOrganizationId: orgB, currency: "USD", validUntil: new Date(Date.now() + 86400000).toISOString() });

    const allowed = await attemptDealTransition(dealId, "quotes_received", sessionUser("admin@example.com"), "now has a quote");
    expect(allowed.ok).toBe(true);
  });

  it("ROLE AUTHORIZATION IS REAL — a verification_analyst cannot perform the administrator-only payment_confirmed transition", async () => {
    const dealId = await makeDeal();
    await getDb().update(deals).set({ stage: "preshipment_evidence_approved" }).where(eq(deals.id, dealId));
    const result = await attemptDealTransition(dealId, "payment_confirmed", sessionUser("analyst@example.com", "verification_analyst"), "trying");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.error).toMatch(/administrator/);
    }
  });

  it("an administrator CAN perform the payment_confirmed transition", async () => {
    const dealId = await makeDeal();
    await getDb().update(deals).set({ stage: "preshipment_evidence_approved" }).where(eq(deals.id, dealId));
    const result = await attemptDealTransition(dealId, "payment_confirmed", sessionUser("admin@example.com", "administrator"), "licensed partner confirmed payment");
    expect(result.ok).toBe(true);
  });

  it("returns 404 for a nonexistent deal", async () => {
    const result = await attemptDealTransition(999999, "parties_assigned", sessionUser("admin@example.com"), "x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });
});
