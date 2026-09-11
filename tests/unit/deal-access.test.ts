// docs/AUDIT.md §5 item 5: dealParties existed in the schema but was never
// consulted, so a legitimate counterparty or verification analyst had no
// path to view a deal (deal room, documents). This proves
// resolveDealViewAccess() actually grants access along each real,
// DB-backed relationship it claims to — and denies it otherwise — against
// a real D1-backed database (not mocks), matching the project's existing
// authorization-test convention (see current-user.test.ts).
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../../db";
import { deals, dealParties, organizationMembers, organizations, users } from "../../db/schema";
import { resolveDealViewAccess } from "../../lib/auth/deal-access";
import type { SessionUser } from "../../lib/auth/current-user";

function sessionUser(id: number, email: string, platformRole: SessionUser["platformRole"] = null): SessionUser {
  return { id, email, displayName: "Test User", platformRole, status: "active", emailVerifiedAt: null };
}

async function makeUser(email: string, platformRole: SessionUser["platformRole"] = null) {
  const db = getDb();
  const [row] = await db.insert(users).values({ email, passwordHash: "pbkdf2$sha256$1$AA$AA", displayName: "Test User", platformRole }).returning({ id: users.id });
  return row.id;
}

async function makeDeal(ownerEmail: string) {
  const db = getDb();
  const [row] = await db.insert(deals).values({ reference: `DEAL-${crypto.randomUUID()}`, ownerEmail, requestType: "buy", product: "Rice", origin: "Ghana", destination: "Nigeria" }).returning({ id: deals.id });
  return row.id;
}

async function makeOrganization(ownerEmail: string) {
  const db = getDb();
  const [row] = await db.insert(organizations).values({ ownerEmail, legalName: `Org ${crypto.randomUUID()}`, country: "Ghana" }).returning({ id: organizations.id });
  return row.id;
}

describe("lib/auth/deal-access resolveDealViewAccess", () => {
  beforeEach(async () => {
    const db = getDb();
    await db.delete(dealParties);
    await db.delete(organizationMembers);
    await db.delete(organizations);
    await db.delete(deals);
    await db.delete(users);
  });

  it("returns null for a deal that doesn't exist", async () => {
    const userId = await makeUser("nobody@example.com");
    const result = await resolveDealViewAccess(999999, sessionUser(userId, "nobody@example.com"));
    expect(result).toBeNull();
  });

  it("grants the owner access with reason 'owner'", async () => {
    const ownerId = await makeUser("owner@example.com");
    const dealId = await makeDeal("owner@example.com");
    const result = await resolveDealViewAccess(dealId, sessionUser(ownerId, "owner@example.com"));
    expect(result?.reason).toBe("owner");
  });

  it("denies a signed-in user with no relationship to the deal", async () => {
    await makeUser("owner@example.com");
    const strangerId = await makeUser("stranger@example.com");
    const dealId = await makeDeal("owner@example.com");
    const result = await resolveDealViewAccess(dealId, sessionUser(strangerId, "stranger@example.com"));
    expect(result).toBeNull();
  });

  it("grants an administrator access with reason 'platform_role', regardless of deal_parties", async () => {
    await makeUser("owner@example.com");
    const adminId = await makeUser("admin@example.com", "administrator");
    const dealId = await makeDeal("owner@example.com");
    const result = await resolveDealViewAccess(dealId, sessionUser(adminId, "admin@example.com", "administrator"));
    expect(result?.reason).toBe("platform_role");
  });

  it("grants a verification_analyst access with reason 'platform_role'", async () => {
    await makeUser("owner@example.com");
    const analystId = await makeUser("analyst@example.com", "verification_analyst");
    const dealId = await makeDeal("owner@example.com");
    const result = await resolveDealViewAccess(dealId, sessionUser(analystId, "analyst@example.com", "verification_analyst"));
    expect(result?.reason).toBe("platform_role");
  });

  it("grants access to an active member of an organization listed as a deal_parties counterparty", async () => {
    const db = getDb();
    await makeUser("owner@example.com");
    const dealId = await makeDeal("owner@example.com");
    const orgId = await makeOrganization("supplier-boss@example.com");
    await db.insert(dealParties).values({ dealId, organizationId: orgId, role: "supplier" });

    const memberId = await makeUser("supplier-staff@example.com");
    await db.insert(organizationMembers).values({ organizationId: orgId, userId: memberId, role: "trader", status: "active" });

    const result = await resolveDealViewAccess(dealId, sessionUser(memberId, "supplier-staff@example.com"));
    expect(result?.reason).toBe("organization_party");
  });

  it("does NOT grant access to a member whose membership status is not 'active'", async () => {
    const db = getDb();
    await makeUser("owner@example.com");
    const dealId = await makeDeal("owner@example.com");
    const orgId = await makeOrganization("supplier-boss@example.com");
    await db.insert(dealParties).values({ dealId, organizationId: orgId, role: "supplier" });

    const removedMemberId = await makeUser("ex-staff@example.com");
    await db.insert(organizationMembers).values({ organizationId: orgId, userId: removedMemberId, role: "trader", status: "removed" });

    const result = await resolveDealViewAccess(dealId, sessionUser(removedMemberId, "ex-staff@example.com"));
    expect(result).toBeNull();
  });

  it("does NOT leak access to a member of an unrelated organization", async () => {
    const db = getDb();
    await makeUser("owner@example.com");
    const dealId = await makeDeal("owner@example.com");
    const partyOrgId = await makeOrganization("supplier-boss@example.com");
    await db.insert(dealParties).values({ dealId, organizationId: partyOrgId, role: "supplier" });

    const otherOrgId = await makeOrganization("other-boss@example.com");
    const outsiderId = await makeUser("outsider@example.com");
    await db.insert(organizationMembers).values({ organizationId: otherOrgId, userId: outsiderId, role: "trader", status: "active" });

    const result = await resolveDealViewAccess(dealId, sessionUser(outsiderId, "outsider@example.com"));
    expect(result).toBeNull();
  });

  it("grants access via a case-insensitive deal_parties.contact email match when there's no organization link", async () => {
    const db = getDb();
    await makeUser("owner@example.com");
    const dealId = await makeDeal("owner@example.com");
    await db.insert(dealParties).values({ dealId, role: "inspector", contact: "Inspector@Example.com" });

    const inspectorId = await makeUser("inspector@example.com");
    const result = await resolveDealViewAccess(dealId, sessionUser(inspectorId, "inspector@example.com"));
    expect(result?.reason).toBe("contact_match");
  });
});
