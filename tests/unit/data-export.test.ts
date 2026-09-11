// Launch-prep follow-up (docs/production-readiness.md): self-service data
// export. Proves the export contains exactly this user's own real data
// (profile fields, owned/member organizations, owned deals, disputes
// they're party to either way, their notifications, their login history)
// and — just as important — does NOT leak another user's data, doesn't
// leak the password hash, and the API route only ever exports the signed-in
// caller's own data.
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../../db";
import { deals, disputes, notifications, organizationMembers, organizations, securityEvents, users } from "../../db/schema";
import { buildUserDataExport } from "../../lib/data-export";
import { createSession, SESSION_COOKIE_NAME } from "../../lib/auth/session";
import { GET as exportGet } from "../../app/api/account/data-export/route";

async function makeUser(email: string) {
  const db = getDb();
  const [row] = await db.insert(users).values({ email, passwordHash: "pbkdf2$sha256$1$AA$AA", displayName: "Test User", locale: "en" }).returning();
  return row;
}
function reqWithCookie(cookieValue: string | undefined, url: string): Request {
  const headers = new Headers();
  if (cookieValue) headers.set("cookie", `${SESSION_COOKIE_NAME}=${cookieValue}`);
  return new Request(url, { headers });
}

describe("lib/data-export buildUserDataExport", () => {
  beforeEach(async () => {
    const db = getDb();
    await db.delete(notifications);
    await db.delete(disputes);
    await db.delete(deals);
    await db.delete(organizationMembers);
    await db.delete(organizations);
    await db.delete(securityEvents);
    await db.delete(users);
  });

  it("includes the user's own profile, without the password hash", async () => {
    const user = await makeUser("exportme@example.com");
    const data = await buildUserDataExport(user.id);
    expect(data.profile.email).toBe("exportme@example.com");
    expect(data.profile).not.toHaveProperty("passwordHash");
  });

  it("includes organizations the user owns AND organizations they're just a member of, but not an unrelated organization", async () => {
    const user = await makeUser("orguser@example.com");
    const db = getDb();
    const [owned] = await db.insert(organizations).values({ ownerEmail: user.email, legalName: "Owned Org", country: "Ghana" }).returning();
    const [memberOf] = await db.insert(organizations).values({ ownerEmail: "someoneelse@example.com", legalName: "Member Org", country: "Kenya" }).returning();
    await db.insert(organizationMembers).values({ organizationId: memberOf.id, userId: user.id, role: "trader", status: "active" });
    await db.insert(organizations).values({ ownerEmail: "unrelated@example.com", legalName: "Unrelated Org", country: "Nigeria" });

    const data = await buildUserDataExport(user.id);
    const names = data.organizations.map((o) => (o as { legalName: string }).legalName);
    expect(names).toContain("Owned Org");
    expect(names).toContain("Member Org");
    expect(names).not.toContain("Unrelated Org");
    void owned;
  });

  it("includes deals the user owns but not another user's deal", async () => {
    const user = await makeUser("dealuser@example.com");
    const db = getDb();
    await db.insert(deals).values({ reference: `MINE-${crypto.randomUUID()}`, ownerEmail: user.email, requestType: "buy", product: "Rice", origin: "Ghana", destination: "Nigeria", stage: "request_confirmed" });
    await db.insert(deals).values({ reference: `THEIRS-${crypto.randomUUID()}`, ownerEmail: "other@example.com", requestType: "buy", product: "Maize", origin: "Kenya", destination: "Uganda", stage: "request_confirmed" });

    const data = await buildUserDataExport(user.id);
    const refs = data.deals.map((d) => (d as { reference: string }).reference);
    expect(refs.some((r) => r.startsWith("MINE-"))).toBe(true);
    expect(refs.some((r) => r.startsWith("THEIRS-"))).toBe(false);
  });

  it("includes disputes the user opened OR is respondent on, but not an unrelated dispute", async () => {
    const user = await makeUser("disputeuser@example.com");
    const db = getDb();
    const [deal] = await db.insert(deals).values({ reference: `D-${crypto.randomUUID()}`, ownerEmail: "someone@example.com", requestType: "buy", product: "Rice", origin: "Ghana", destination: "Nigeria", stage: "request_confirmed" }).returning();
    await db.insert(disputes).values({ reference: `DIS-OPENED-${crypto.randomUUID()}`, dealId: deal.id, openedByEmail: user.email, category: "quality", description: "x", status: "open" });
    await db.insert(disputes).values({ reference: `DIS-RESPONDENT-${crypto.randomUUID()}`, dealId: deal.id, openedByEmail: "other@example.com", respondentEmail: user.email, category: "quality", description: "x", status: "open" });
    await db.insert(disputes).values({ reference: `DIS-UNRELATED-${crypto.randomUUID()}`, dealId: deal.id, openedByEmail: "a@example.com", respondentEmail: "b@example.com", category: "quality", description: "x", status: "open" });

    const data = await buildUserDataExport(user.id);
    const refs = data.disputes.map((d) => (d as { reference: string }).reference);
    expect(refs.some((r) => r.startsWith("DIS-OPENED-"))).toBe(true);
    expect(refs.some((r) => r.startsWith("DIS-RESPONDENT-"))).toBe(true);
    expect(refs.some((r) => r.startsWith("DIS-UNRELATED-"))).toBe(false);
  });

  it("includes the user's own notifications and login history, not another user's", async () => {
    const user = await makeUser("notifuser@example.com");
    const db = getDb();
    await db.insert(notifications).values({ recipientEmail: user.email, eventType: "x", entityType: "deal", entityId: 1, titleKey: "t", bodyKey: "b" });
    await db.insert(notifications).values({ recipientEmail: "other@example.com", eventType: "x", entityType: "deal", entityId: 2, titleKey: "t", bodyKey: "b" });
    await db.insert(securityEvents).values({ eventType: "login_success", email: user.email });
    await db.insert(securityEvents).values({ eventType: "login_success", email: "other@example.com" });

    const data = await buildUserDataExport(user.id);
    expect(data.notifications.length).toBe(1);
    expect(data.loginHistory.length).toBe(1);
  });
});

describe("GET /api/account/data-export", () => {
  beforeEach(async () => {
    await getDb().delete(users);
  });

  it("requires sign-in", async () => {
    const res = await exportGet(reqWithCookie(undefined, "https://x/api/account/data-export"));
    expect(res.status).toBe(401);
  });

  it("returns the signed-in user's own export as a downloadable JSON attachment", async () => {
    const user = await makeUser("routeuser@example.com");
    const { cookieValue } = await createSession(user.id, {});
    const res = await exportGet(reqWithCookie(cookieValue, "https://x/api/account/data-export"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const body = (await res.json()) as { profile: { email: string } };
    expect(body.profile.email).toBe("routeuser@example.com");
  });
});
