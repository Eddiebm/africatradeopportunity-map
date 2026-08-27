// docs/AUDIT.md Priority 1: "Deal-party assignment and removal" +
// protection against IDOR, role escalation, and self-assignment. Calls
// the actual route handlers (not just the underlying helper) against a
// real D1-backed test database, matching current-user.test.ts's
// convention — this exercises the exact code path a real request hits,
// including body parsing and the 403/404 shaping.
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../../db";
import { deals, dealEvents, dealParties, organizationMembers, organizations, sessions, users } from "../../db/schema";
import { resolveDealViewAccess } from "../../lib/auth/deal-access";
import { DELETE, GET, POST } from "../../app/api/deals/[id]/parties/route";

async function makeUser(email: string) {
  const db = getDb();
  const [row] = await db.insert(users).values({ email, passwordHash: "pbkdf2$sha256$1$AA$AA", displayName: "Test User" }).returning({ id: users.id });
  return row.id;
}

async function makeDeal(ownerEmail: string) {
  const db = getDb();
  const [row] = await db.insert(deals).values({ reference: `DEAL-${crypto.randomUUID()}`, ownerEmail, requestType: "buy", product: "Rice", origin: "Ghana", destination: "Nigeria" }).returning({ id: deals.id });
  return row.id;
}

async function makeOrganization() {
  const db = getDb();
  const [row] = await db.insert(organizations).values({ ownerEmail: "org-owner@example.com", legalName: `Org ${crypto.randomUUID()}`, country: "Ghana" }).returning({ id: organizations.id });
  return row.id;
}

function reqWithCookie(cookieValue: string, method: string, body?: unknown): Request {
  const headers = new Headers({ cookie: `ts_session=${cookieValue}` });
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(body);
  }
  return new Request("http://localhost/api/deals/1/parties", init);
}

async function sessionCookieFor(userId: number) {
  const { createSession } = await import("../../lib/auth/session");
  const { cookieValue } = await createSession(userId, {});
  return cookieValue;
}

describe("app/api/deals/[id]/parties route", () => {
  beforeEach(async () => {
    const db = getDb();
    await db.delete(dealEvents);
    await db.delete(organizationMembers);
    await db.delete(dealParties);
    await db.delete(organizations);
    await db.delete(deals);
    await db.delete(sessions);
    await db.delete(users);
  });

  it("lets the owner assign a party; a total stranger gets 404 (no knowledge the deal exists), not 403", async () => {
    const ownerId = await makeUser("owner@example.com");
    const strangerId = await makeUser("stranger@example.com");
    const dealId = await makeDeal("owner@example.com");
    const orgId = await makeOrganization();

    const ownerCookie = await sessionCookieFor(ownerId);
    const ok = await POST(reqWithCookie(ownerCookie, "POST", { role: "supplier", organizationId: orgId, name: "Acme Supplies" }), { params: Promise.resolve({ id: String(dealId) }) });
    expect(ok.status).toBe(201);

    const strangerCookie = await sessionCookieFor(strangerId);
    const denied = await POST(reqWithCookie(strangerCookie, "POST", { role: "supplier", organizationId: orgId }), { params: Promise.resolve({ id: String(dealId) }) });
    expect(denied.status).toBe(404); // matches the 404-not-403 convention: a stranger shouldn't learn the deal exists at all
  });

  it("a counterparty WITH legitimate view access still cannot manage parties — least privilege, view is not manage", async () => {
    const memberId = await makeUser("member@example.com");
    const dealId = await makeDeal("owner@example.com");
    const orgId = await makeOrganization();
    const db = getDb();
    await db.insert(dealParties).values({ dealId, organizationId: orgId, role: "supplier" });
    await db.insert(organizationMembers).values({ organizationId: orgId, userId: memberId, role: "trader", status: "active" });

    const memberCookie = await sessionCookieFor(memberId);
    // This member genuinely CAN view the deal (proven by GET succeeding)...
    const list = await GET(reqWithCookie(memberCookie, "GET"), { params: Promise.resolve({ id: String(dealId) }) });
    expect(list.status).toBe(200);
    // ...but still cannot assign another party — that stays owner-only.
    const attempt = await POST(reqWithCookie(memberCookie, "POST", { role: "broker", contact: "broker@example.com" }), { params: Promise.resolve({ id: String(dealId) }) });
    expect(attempt.status).toBe(403);
  });

  it("rejects an invalid role (no role escalation via a made-up value)", async () => {
    const ownerId = await makeUser("owner@example.com");
    const dealId = await makeDeal("owner@example.com");
    const cookie = await sessionCookieFor(ownerId);
    const res = await POST(reqWithCookie(cookie, "POST", { role: "administrator", contact: "x@example.com" }), { params: Promise.resolve({ id: String(dealId) }) });
    expect(res.status).toBe(400); // "administrator" is a platform role, not a deal-party role
  });

  it("rejects an organizationId that doesn't exist", async () => {
    const ownerId = await makeUser("owner@example.com");
    const dealId = await makeDeal("owner@example.com");
    const cookie = await sessionCookieFor(ownerId);
    const res = await POST(reqWithCookie(cookie, "POST", { role: "supplier", organizationId: 999999 }), { params: Promise.resolve({ id: String(dealId) }) });
    expect(res.status).toBe(400);
  });

  it("DELETE is scoped to THIS deal — cannot remove a party that actually belongs to a different deal (IDOR)", async () => {
    const ownerId = await makeUser("owner@example.com");
    const dealAId = await makeDeal("owner@example.com");
    const dealBId = await makeDeal("owner@example.com"); // same owner, different deal — still must not cross
    const orgId = await makeOrganization();
    const db = getDb();
    const [partyOnDealB] = await db.insert(dealParties).values({ dealId: dealBId, organizationId: orgId, role: "supplier" }).returning();

    const cookie = await sessionCookieFor(ownerId);
    const res = await DELETE(reqWithCookie(cookie, "DELETE", { partyId: partyOnDealB.id }), { params: Promise.resolve({ id: String(dealAId) }) });
    expect(res.status).toBe(404);

    const rows = await db.select().from(dealParties);
    const row = rows.find((r) => r.id === partyOnDealB.id);
    expect(row?.removedAt).toBeNull(); // the cross-deal removal attempt did NOT go through
  });

  it("a removed party is excluded from GET and no longer grants deal view access", async () => {
    const ownerId = await makeUser("owner@example.com");
    const dealId = await makeDeal("owner@example.com");
    const orgId = await makeOrganization();
    const cookie = await sessionCookieFor(ownerId);

    const created = await POST(reqWithCookie(cookie, "POST", { role: "supplier", organizationId: orgId, name: "Acme" }), { params: Promise.resolve({ id: String(dealId) }) });
    const { party } = (await created.json()) as { party: { id: number } };

    const removed = await DELETE(reqWithCookie(cookie, "DELETE", { partyId: party.id }), { params: Promise.resolve({ id: String(dealId) }) });
    expect(removed.status).toBe(200);

    const list = await GET(reqWithCookie(cookie, "GET"), { params: Promise.resolve({ id: String(dealId) }) });
    const { parties } = (await list.json()) as { parties: unknown[] };
    expect(parties.length).toBe(0);

    // And the actual access check a counterparty from that org would rely
    // on is now denied — a member of this org can no longer view the deal.
    const memberId = await makeUser("member@example.com");
    const db = getDb();
    await db.insert(organizationMembers).values({ organizationId: orgId, userId: memberId, role: "trader", status: "active" });
    const access = await resolveDealViewAccess(dealId, { id: memberId, email: "member@example.com", displayName: "M", platformRole: null, status: "active", emailVerifiedAt: null });
    expect(access).toBeNull();
  });

  it("GET requires deal access — an unrelated user gets 404, not the party list", async () => {
    const strangerId = await makeUser("stranger@example.com");
    const dealId = await makeDeal("owner@example.com");
    const strangerCookie = await sessionCookieFor(strangerId);
    const res = await GET(reqWithCookie(strangerCookie, "GET"), { params: Promise.resolve({ id: String(dealId) }) });
    expect(res.status).toBe(404);
  });

  it("an anonymous request (no session cookie) is rejected", async () => {
    const dealId = await makeDeal("owner@example.com");
    const res = await GET(new Request("http://localhost/api/deals/1/parties"), { params: Promise.resolve({ id: String(dealId) }) });
    expect(res.status).toBe(401);
  });
});
