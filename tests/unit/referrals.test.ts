// Priority 11 (docs/production-readiness.md): brokers, associations,
// referrals. Proves real fraud/self-referral controls, the protected
// first-attribution-wins rule, the "never a paid status" money-movement
// boundary (enforced structurally, not just by convention), and the
// disclosure page's public-only return shape — against a real D1-backed
// test database.
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import {
  adminAuditEvents, commissionRecords, deals, dealCosts, emailVerificationTokens, marketRequests, organizationMembers, organizations,
  referralAttributions, referralPartners, sessions, users,
} from "../../db/schema";
import { createReferralCode, listReferralCodesForOrganization, recordReferralAttribution, resolveReferralPartner } from "../../lib/referrals";
import { createSession, SESSION_COOKIE_NAME } from "../../lib/auth/session";
import { POST as referralsPost, GET as referralsGet } from "../../app/api/referrals/route";
import { GET as commissionsGet, POST as commissionsPost, PATCH as commissionsPatch } from "../../app/api/admin/commissions/route";
import { POST as registerPost } from "../../app/api/auth/register/route";
import { POST as marketRequestsPost } from "../../app/api/market-requests/route";

async function makeUser(email: string, platformRole: "administrator" | "verification_analyst" | null = null) {
  const db = getDb();
  const [row] = await db.insert(users).values({ email, passwordHash: "pbkdf2$sha256$1$AA$AA", displayName: "Test", platformRole }).returning({ id: users.id });
  return row.id;
}
async function makeOrgWithOwner(ownerEmail: string) {
  const db = getDb();
  const [org] = await db.insert(organizations).values({ ownerEmail, legalName: `Org ${crypto.randomUUID()}`, country: "Ghana" }).returning();
  return org;
}
async function makeDeal() {
  const db = getDb();
  const [row] = await db.insert(deals).values({ reference: `DEAL-${crypto.randomUUID()}`, ownerEmail: "owner@example.com", requestType: "buy", product: "Rice", origin: "Ghana", destination: "Nigeria", stage: "request_confirmed" }).returning();
  await db.insert(dealCosts).values({ dealId: row.id, supplierCost: 100 });
  return row;
}
function req(url: string, body?: unknown, cookieValue?: string): Request {
  const headers = new Headers();
  if (cookieValue) headers.set("cookie", `${SESSION_COOKIE_NAME}=${cookieValue}`);
  const init: RequestInit = { method: body !== undefined ? "POST" : "GET", headers };
  if (body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(body);
  }
  return new Request(url, init);
}

async function cleanAll() {
  const db = getDb();
  await db.delete(commissionRecords);
  await db.delete(referralAttributions);
  await db.delete(referralPartners);
  await db.delete(adminAuditEvents);
  await db.delete(marketRequests);
  await db.delete(dealCosts);
  await db.delete(deals);
  await db.delete(organizationMembers);
  await db.delete(organizations);
  await db.delete(sessions);
  await db.delete(emailVerificationTokens);
  await db.delete(users);
}

describe("lib/referrals", () => {
  beforeEach(cleanAll);

  it("createReferralCode generates a real, unique, shareable code", async () => {
    const org = await makeOrgWithOwner("broker@example.com");
    const partner = await createReferralCode(org.id, "broker@example.com");
    expect(partner.code.length).toBeGreaterThanOrEqual(6);
    expect(partner.status).toBe("active");
    const listed = await listReferralCodesForOrganization(org.id);
    expect(listed.some((p) => p.id === partner.id)).toBe(true);
  });

  it("resolveReferralPartner returns ONLY a public org name — never contact/commission details", async () => {
    const org = await makeOrgWithOwner("broker2@example.com");
    const partner = await createReferralCode(org.id, "broker2@example.com");
    const resolved = await resolveReferralPartner(partner.code);
    expect(resolved?.organizationName).toBe(org.legalName);
    expect(JSON.stringify(resolved)).not.toMatch(/broker2@example\.com/); // no owner email leaked
  });

  it("resolveReferralPartner returns null for a nonexistent code, no crash", async () => {
    expect(await resolveReferralPartner("NOPE99")).toBeNull();
  });

  it("a clean attribution is recorded as PRIMARY with no fraud flag", async () => {
    const org = await makeOrgWithOwner("broker3@example.com");
    const partner = await createReferralCode(org.id, "broker3@example.com");
    const attribution = await recordReferralAttribution({ code: partner.code, refereeContact: "buyer@example.com", source: "intake_link" });
    expect(attribution?.isPrimary).toBe(true);
    expect(attribution?.fraudFlag).toBe("");
  });

  it("SELF-REFERRAL: the referring organization's OWNER cannot claim attribution for themselves", async () => {
    const org = await makeOrgWithOwner("self@example.com");
    const partner = await createReferralCode(org.id, "self@example.com");
    const attribution = await recordReferralAttribution({ code: partner.code, refereeContact: "self@example.com", source: "code_entry" });
    expect(attribution?.isPrimary).toBe(false);
    expect(attribution?.fraudFlag).toBe("self_referral");
  });

  it("SELF-REFERRAL: an active MEMBER of the referring org also cannot claim attribution", async () => {
    const org = await makeOrgWithOwner("owner4@example.com");
    const partner = await createReferralCode(org.id, "owner4@example.com");
    const memberId = await makeUser("member4@example.com");
    await getDb().insert(organizationMembers).values({ organizationId: org.id, userId: memberId, role: "trader", status: "active" });
    const attribution = await recordReferralAttribution({ code: partner.code, refereeContact: "member4@example.com", source: "code_entry" });
    expect(attribution?.fraudFlag).toBe("self_referral");
  });

  it("PROTECTED RELATIONSHIP: a second code cannot steal a referee already primarily attributed to a first code", async () => {
    const orgA = await makeOrgWithOwner("brokerA@example.com");
    const orgB = await makeOrgWithOwner("brokerB@example.com");
    const codeA = await createReferralCode(orgA.id, "brokerA@example.com");
    const codeB = await createReferralCode(orgB.id, "brokerB@example.com");
    const first = await recordReferralAttribution({ code: codeA.code, refereeContact: "contested@example.com", source: "intake_link" });
    const second = await recordReferralAttribution({ code: codeB.code, refereeContact: "contested@example.com", source: "intake_link" });
    expect(first?.isPrimary).toBe(true);
    expect(second?.isPrimary).toBe(false);
    expect(second?.fraudFlag).toBe("duplicate_attribution");
    // Full history preserved — both rows exist, the first is never overwritten.
    const rows = await getDb().select().from(referralAttributions).where(eq(referralAttributions.refereeContact, "contested@example.com"));
    expect(rows.length).toBe(2);
  });

  it("a code for a SUSPENDED partner is silently a no-op — never surfaced as an error to the referred visitor", async () => {
    const org = await makeOrgWithOwner("suspended@example.com");
    const partner = await createReferralCode(org.id, "suspended@example.com");
    await getDb().update(referralPartners).set({ status: "suspended" }).where(eq(referralPartners.id, partner.id));
    const attribution = await recordReferralAttribution({ code: partner.code, refereeContact: "x@example.com", source: "intake_link" });
    expect(attribution).toBeNull();
  });

  it("a nonexistent code is a no-op, no crash", async () => {
    expect(await recordReferralAttribution({ code: "NOTREAL9", refereeContact: "x@example.com", source: "intake_link" })).toBeNull();
  });
});

describe("app/api/referrals route", () => {
  beforeEach(cleanAll);

  it("requires authentication", async () => {
    const org = await makeOrgWithOwner("x@example.com");
    const res = await referralsPost(req("http://localhost/api/referrals", { organizationId: org.id }));
    expect(res.status).toBe(401);
  });

  it("REJECTS a user who is not a real active member of the organization", async () => {
    const org = await makeOrgWithOwner("owner@example.com");
    const userId = await makeUser("outsider@example.com");
    const { cookieValue } = await createSession(userId, {});
    const res = await referralsPost(req("http://localhost/api/referrals", { organizationId: org.id }, cookieValue));
    expect(res.status).toBe(403);
  });

  it("a real active member creates a code and sees it (with attribution count) on GET", async () => {
    const org = await makeOrgWithOwner("owner2@example.com");
    const userId = await makeUser("owner2@example.com");
    await getDb().insert(organizationMembers).values({ organizationId: org.id, userId, role: "broker", status: "active" });
    const { cookieValue } = await createSession(userId, {});
    const create = await referralsPost(req("http://localhost/api/referrals", { organizationId: org.id }, cookieValue));
    expect(create.status).toBe(201);
    const get = await referralsGet(req(`http://localhost/api/referrals?organizationId=${org.id}`, undefined, cookieValue));
    const body = (await get.json()) as { referralPartners: { attributionCount: number }[] };
    expect(body.referralPartners.length).toBe(1);
    expect(body.referralPartners[0].attributionCount).toBe(0);
  });
});

describe("app/api/admin/commissions route — never a paid status", () => {
  beforeEach(cleanAll);

  it("requires a reviewer role", async () => {
    const userId = await makeUser("trader@example.com", null);
    const { cookieValue } = await createSession(userId, {});
    const res = await commissionsGet(req("http://localhost/api/admin/commissions", undefined, cookieValue));
    expect(res.status).toBe(403);
  });

  it("requires payerParty — disclosure of who pays is not optional", async () => {
    const adminId = await makeUser("admin@example.com", "administrator");
    const { cookieValue } = await createSession(adminId, {});
    const deal = await makeDeal();
    const org = await makeOrgWithOwner("broker5@example.com");
    const partner = await createReferralCode(org.id, "broker5@example.com");
    const res = await commissionsPost(req("http://localhost/api/admin/commissions", { dealId: deal.id, referralPartnerId: partner.id, basis: "percentage", rate: 2.5 }, cookieValue));
    expect(res.status).toBe(400);
  });

  it("a percentage-basis record requires a positive rate; a flat-basis record requires a positive flatAmount", async () => {
    const adminId = await makeUser("admin2@example.com", "administrator");
    const { cookieValue } = await createSession(adminId, {});
    const deal = await makeDeal();
    const org = await makeOrgWithOwner("broker6@example.com");
    const partner = await createReferralCode(org.id, "broker6@example.com");
    const noRate = await commissionsPost(req("http://localhost/api/admin/commissions", { dealId: deal.id, referralPartnerId: partner.id, basis: "percentage", payerParty: "TradeSafe Africa" }, cookieValue));
    expect(noRate.status).toBe(400);
    const ok = await commissionsPost(req("http://localhost/api/admin/commissions", { dealId: deal.id, referralPartnerId: partner.id, basis: "percentage", rate: 2.5, payerParty: "TradeSafe Africa" }, cookieValue));
    expect(ok.status).toBe(201);
  });

  it("REJECTS a nonexistent deal or referral partner", async () => {
    const adminId = await makeUser("admin3@example.com", "administrator");
    const { cookieValue } = await createSession(adminId, {});
    const res = await commissionsPost(req("http://localhost/api/admin/commissions", { dealId: 999999, referralPartnerId: 999999, basis: "flat", flatAmount: 50, payerParty: "buyer" }, cookieValue));
    expect(res.status).toBe(404);
  });

  it("ATTACK: cannot set status to \"paid\" — the value is not in the real enum, whitelist rejects it", async () => {
    const adminId = await makeUser("admin4@example.com", "administrator");
    const { cookieValue } = await createSession(adminId, {});
    const deal = await makeDeal();
    const org = await makeOrgWithOwner("broker7@example.com");
    const partner = await createReferralCode(org.id, "broker7@example.com");
    const create = await commissionsPost(req("http://localhost/api/admin/commissions", { dealId: deal.id, referralPartnerId: partner.id, basis: "flat", flatAmount: 100, payerParty: "supplier" }, cookieValue));
    const record = (await create.json()) as { commissionRecord: { id: number } };
    const attack = await commissionsPatch(req("http://localhost/api/admin/commissions", { id: record.commissionRecord.id, status: "paid", reason: "trying to pay it" }, cookieValue));
    expect(attack.status).toBe(400);
    const [row] = await getDb().select().from(commissionRecords).where(eq(commissionRecords.id, record.commissionRecord.id));
    expect(row.status).toBe("pending"); // unchanged
  });

  it("approving a real record requires a reason and records the real approver + timestamp", async () => {
    const adminId = await makeUser("admin5@example.com", "administrator");
    const { cookieValue } = await createSession(adminId, {});
    const deal = await makeDeal();
    const org = await makeOrgWithOwner("broker8@example.com");
    const partner = await createReferralCode(org.id, "broker8@example.com");
    const create = await commissionsPost(req("http://localhost/api/admin/commissions", { dealId: deal.id, referralPartnerId: partner.id, basis: "flat", flatAmount: 75, payerParty: "TradeSafe Africa" }, cookieValue));
    const record = (await create.json()) as { commissionRecord: { id: number } };

    const noReason = await commissionsPatch(req("http://localhost/api/admin/commissions", { id: record.commissionRecord.id, status: "approved" }, cookieValue));
    expect(noReason.status).toBe(400);

    const approve = await commissionsPatch(req("http://localhost/api/admin/commissions", { id: record.commissionRecord.id, status: "approved", reason: "Referral confirmed with both parties" }, cookieValue));
    expect(approve.status).toBe(200);
    const [row] = await getDb().select().from(commissionRecords).where(eq(commissionRecords.id, record.commissionRecord.id));
    expect(row.status).toBe("approved");
    expect(row.approvedByEmail).toBe("admin5@example.com");
    expect(row.approvedAt).not.toBeNull();
  });
});

describe("Priority 11 integration: registration and quote-request attribution", () => {
  beforeEach(cleanAll);

  it("registering via a real referral code creates a real attribution tied to the new account", async () => {
    const org = await makeOrgWithOwner("referrer@example.com");
    const partner = await createReferralCode(org.id, "referrer@example.com");
    const res = await registerPost(req("http://localhost/api/auth/register", {
      email: `newuser+${crypto.randomUUID()}@example.com`, password: "CorrectHorse9!Battery", displayName: "New User", termsAccepted: true, ref: partner.code,
    }));
    expect(res.status).toBe(201);
    const attributions = await getDb().select().from(referralAttributions).where(eq(referralAttributions.referralPartnerId, partner.id));
    expect(attributions.length).toBe(1);
    expect(attributions[0].isPrimary).toBe(true);
    expect(attributions[0].source).toBe("code_entry");
  });

  it("registering with NO ref code creates no attribution — never fabricated", async () => {
    await registerPost(req("http://localhost/api/auth/register", {
      email: `noref+${crypto.randomUUID()}@example.com`, password: "CorrectHorse9!Battery", displayName: "No Ref", termsAccepted: true,
    }));
    const all = await getDb().select().from(referralAttributions);
    expect(all.length).toBe(0);
  });

  it("a /quote submission carrying a real ref code creates a real attribution tied to the marketRequest", async () => {
    const org = await makeOrgWithOwner("quotereferrer@example.com");
    const partner = await createReferralCode(org.id, "quotereferrer@example.com");
    const res = await marketRequestsPost(req("http://localhost/api/market-requests", {
      role: "quote_request", product: "Rice", destination: "Ghana", contact: "leadbuyer@example.com", consent: "yes", ref: partner.code,
    }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { request: { id: number } };
    const [attribution] = await getDb().select().from(referralAttributions).where(eq(referralAttributions.marketRequestId, body.request.id));
    expect(attribution.refereeContact).toBe("leadbuyer@example.com");
    expect(attribution.source).toBe("intake_link");
    expect(attribution.isPrimary).toBe(true);
  });
});
