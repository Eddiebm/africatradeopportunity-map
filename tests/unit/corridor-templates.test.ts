// Priority 5 (docs/production-readiness.md): corridor operating
// templates, versioning, tier resolution, and the public/admin API
// split. Against a real D1-backed test database.
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../../db";
import { corridorTemplates, sessions, users } from "../../db/schema";
import { corridorKeyFor, createCorridorTemplateVersion, getCurrentTemplate, resolveCorridorTier } from "../../lib/corridor-templates";
import { createSession, SESSION_COOKIE_NAME } from "../../lib/auth/session";
import { GET as adminGet, POST as adminPost } from "../../app/api/admin/corridor-templates/route";
import { GET as publicGet } from "../../app/api/corridor-templates/route";

async function makeUser(email: string, platformRole: "administrator" | "verification_analyst" | null = null) {
  const db = getDb();
  const [row] = await db.insert(users).values({ email, passwordHash: "pbkdf2$sha256$1$AA$AA", displayName: "Test", platformRole }).returning({ id: users.id });
  return row.id;
}

function reqWithCookie(cookieValue?: string, body?: unknown): Request {
  const headers = new Headers();
  if (cookieValue) headers.set("cookie", `${SESSION_COOKIE_NAME}=${cookieValue}`);
  const init: RequestInit = { method: body ? "POST" : "GET", headers };
  if (body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(body);
  }
  return new Request("http://localhost/api/admin/corridor-templates", init);
}

const baseTemplate = {
  origin: "Ghana",
  destination: "Nigeria",
  status: "draft" as const,
  confidence: "low",
};

describe("lib/corridor-templates", () => {
  beforeEach(async () => {
    await getDb().delete(corridorTemplates);
  });

  it("corridorKeyFor is a stable, order-sensitive key", () => {
    expect(corridorKeyFor("Ghana", "Nigeria")).toBe("Ghana::Nigeria");
    expect(corridorKeyFor("Ghana", "Nigeria")).not.toBe(corridorKeyFor("Nigeria", "Ghana"));
  });

  it("a corridor with no template row is 'intelligence' tier", async () => {
    const { tier, template } = await resolveCorridorTier("Kenya", "Uganda");
    expect(tier).toBe("intelligence");
    expect(template).toBeNull();
  });

  it("a draft/reviewed template makes a corridor 'operational' tier, not 'verified'", async () => {
    await createCorridorTemplateVersion({
      corridorKey: corridorKeyFor("Ghana", "Nigeria"),
      ...baseTemplate,
      productCategoriesJson: "[]", requiredBuyerInfo: "", requiredSupplierInfo: "", requiredDocumentsJson: "[]",
      verificationRequirements: "", standardMilestonesJson: "[]", evidenceRequiredJson: "{}", approvedPartnerRolesJson: "[]",
      expectedTiming: "", costComponentsJson: "[]", riskRules: "", escalationRules: "", sourceAttribution: "",
      reviewerEmail: "", createdByEmail: "admin@example.com",
    });
    const { tier } = await resolveCorridorTier("Ghana", "Nigeria");
    expect(tier).toBe("operational");
  });

  it("an 'operational' status template makes a corridor 'verified' tier", async () => {
    await createCorridorTemplateVersion({
      corridorKey: corridorKeyFor("Ghana", "Nigeria"),
      ...baseTemplate,
      status: "operational",
      productCategoriesJson: "[]", requiredBuyerInfo: "", requiredSupplierInfo: "", requiredDocumentsJson: "[]",
      verificationRequirements: "", standardMilestonesJson: "[]", evidenceRequiredJson: "{}", approvedPartnerRolesJson: "[]",
      expectedTiming: "", costComponentsJson: "[]", riskRules: "", escalationRules: "", sourceAttribution: "real source",
      reviewerEmail: "reviewer@example.com", createdByEmail: "admin@example.com",
    });
    const { tier } = await resolveCorridorTier("Ghana", "Nigeria");
    expect(tier).toBe("verified");
  });

  it("editing a corridor NEVER mutates the old row — it inserts a new version, and getCurrentTemplate returns the newest", async () => {
    const key = corridorKeyFor("Ghana", "Nigeria");
    const v1 = await createCorridorTemplateVersion({
      corridorKey: key, ...baseTemplate,
      productCategoriesJson: "[]", requiredBuyerInfo: "", requiredSupplierInfo: "", requiredDocumentsJson: "[]",
      verificationRequirements: "", standardMilestonesJson: "[]", evidenceRequiredJson: "{}", approvedPartnerRolesJson: "[]",
      expectedTiming: "v1 timing", costComponentsJson: "[]", riskRules: "", escalationRules: "", sourceAttribution: "",
      reviewerEmail: "", createdByEmail: "admin@example.com",
    });
    const v2 = await createCorridorTemplateVersion({
      corridorKey: key, ...baseTemplate,
      productCategoriesJson: "[]", requiredBuyerInfo: "", requiredSupplierInfo: "", requiredDocumentsJson: "[]",
      verificationRequirements: "", standardMilestonesJson: "[]", evidenceRequiredJson: "{}", approvedPartnerRolesJson: "[]",
      expectedTiming: "v2 timing", costComponentsJson: "[]", riskRules: "", escalationRules: "", sourceAttribution: "",
      reviewerEmail: "", createdByEmail: "admin@example.com",
    });
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(v1.id).not.toBe(v2.id); // genuinely two rows, not an update

    const current = await getCurrentTemplate(key);
    expect(current?.version).toBe(2);
    expect(current?.expectedTiming).toBe("v2 timing");

    // v1's row is untouched — this is what makes a deal created under v1
    // a permanent historical record, not a pointer that silently changed.
    const rows = await getDb().select().from(corridorTemplates);
    const v1Row = rows.find((r) => r.id === v1.id);
    expect(v1Row?.expectedTiming).toBe("v1 timing");
  });
});

describe("app/api/admin/corridor-templates route", () => {
  beforeEach(async () => {
    const db = getDb();
    await db.delete(corridorTemplates);
    await db.delete(sessions);
    await db.delete(users);
  });

  it("requires authentication", async () => {
    const res = await adminGet(reqWithCookie(undefined));
    expect(res.status).toBe(401);
  });

  it("requires administrator specifically", async () => {
    const userId = await makeUser("analyst@example.com", "verification_analyst");
    const { cookieValue } = await createSession(userId, {});
    const res = await adminPost(reqWithCookie(cookieValue, { origin: "Ghana", destination: "Nigeria" }));
    expect(res.status).toBe(403);
  });

  it("rejects a 'reviewed'/'operational' status without a real sourceAttribution and reviewerEmail — no fabricated verification", async () => {
    const adminId = await makeUser("admin@example.com", "administrator");
    const { cookieValue } = await createSession(adminId, {});
    const res = await adminPost(reqWithCookie(cookieValue, { origin: "Ghana", destination: "Nigeria", status: "operational", confidence: "high" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/sourceAttribution|reviewerEmail/);
  });

  it("rejects an invalid approvedPartnerRoles entry", async () => {
    const adminId = await makeUser("admin@example.com", "administrator");
    const { cookieValue } = await createSession(adminId, {});
    const res = await adminPost(reqWithCookie(cookieValue, { origin: "Ghana", destination: "Nigeria", approvedPartnerRoles: ["not_a_real_role"] }));
    expect(res.status).toBe(400);
  });

  it("an administrator can create a valid draft template", async () => {
    const adminId = await makeUser("admin@example.com", "administrator");
    const { cookieValue } = await createSession(adminId, {});
    const res = await adminPost(reqWithCookie(cookieValue, { origin: "Ghana", destination: "Nigeria", status: "draft", confidence: "low" }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { template: { version: number; status: string } };
    expect(body.template.version).toBe(1);
    expect(body.template.status).toBe("draft");
  });
});

describe("GET /api/corridor-templates (public)", () => {
  beforeEach(async () => {
    await getDb().delete(corridorTemplates);
  });

  it("is unauthenticated and returns nothing when no templates exist", async () => {
    const res = await publicGet();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { corridors: unknown[] };
    expect(body.corridors).toEqual([]);
  });

  it("excludes internal fields (riskRules, escalationRules, requiredBuyerInfo) from the public response", async () => {
    await createCorridorTemplateVersion({
      corridorKey: corridorKeyFor("Ghana", "Nigeria"), origin: "Ghana", destination: "Nigeria",
      status: "operational", confidence: "high",
      productCategoriesJson: "[]", requiredBuyerInfo: "SECRET internal buyer requirement", requiredSupplierInfo: "",
      requiredDocumentsJson: "[]", verificationRequirements: "", standardMilestonesJson: "[]", evidenceRequiredJson: "{}",
      approvedPartnerRolesJson: "[]", expectedTiming: "10-14 days", costComponentsJson: "[]",
      riskRules: "SECRET internal risk rule", escalationRules: "SECRET escalation path", sourceAttribution: "field survey 2026",
      reviewerEmail: "reviewer@example.com", createdByEmail: "admin@example.com",
    });
    const res = await publicGet();
    const body = (await res.json()) as { corridors: Array<Record<string, unknown>> };
    expect(body.corridors.length).toBe(1);
    const c = body.corridors[0];
    expect(c.tier).toBe("verified");
    expect(JSON.stringify(c)).not.toContain("SECRET");
  });

  it("excludes suspended corridors entirely", async () => {
    await createCorridorTemplateVersion({
      corridorKey: corridorKeyFor("Ghana", "Nigeria"), origin: "Ghana", destination: "Nigeria",
      status: "suspended", confidence: "low",
      productCategoriesJson: "[]", requiredBuyerInfo: "", requiredSupplierInfo: "", requiredDocumentsJson: "[]",
      verificationRequirements: "", standardMilestonesJson: "[]", evidenceRequiredJson: "{}", approvedPartnerRolesJson: "[]",
      expectedTiming: "", costComponentsJson: "[]", riskRules: "", escalationRules: "", sourceAttribution: "",
      reviewerEmail: "", createdByEmail: "admin@example.com",
    });
    const res = await publicGet();
    const body = (await res.json()) as { corridors: unknown[] };
    expect(body.corridors).toEqual([]);
  });

  it("shows only the CURRENT (newest) version when multiple exist", async () => {
    const key = corridorKeyFor("Ghana", "Nigeria");
    await createCorridorTemplateVersion({
      corridorKey: key, origin: "Ghana", destination: "Nigeria", status: "draft", confidence: "low",
      productCategoriesJson: "[]", requiredBuyerInfo: "", requiredSupplierInfo: "", requiredDocumentsJson: "[]",
      verificationRequirements: "", standardMilestonesJson: "[]", evidenceRequiredJson: "{}", approvedPartnerRolesJson: "[]",
      expectedTiming: "old timing", costComponentsJson: "[]", riskRules: "", escalationRules: "", sourceAttribution: "",
      reviewerEmail: "", createdByEmail: "admin@example.com",
    });
    await createCorridorTemplateVersion({
      corridorKey: key, origin: "Ghana", destination: "Nigeria", status: "draft", confidence: "low",
      productCategoriesJson: "[]", requiredBuyerInfo: "", requiredSupplierInfo: "", requiredDocumentsJson: "[]",
      verificationRequirements: "", standardMilestonesJson: "[]", evidenceRequiredJson: "{}", approvedPartnerRolesJson: "[]",
      expectedTiming: "new timing", costComponentsJson: "[]", riskRules: "", escalationRules: "", sourceAttribution: "",
      reviewerEmail: "", createdByEmail: "admin@example.com",
    });
    const res = await publicGet();
    const body = (await res.json()) as { corridors: Array<{ expectedTiming: string; version: number }> };
    expect(body.corridors.length).toBe(1); // one corridor, not one row per version
    expect(body.corridors[0].version).toBe(2);
    expect(body.corridors[0].expectedTiming).toBe("new timing");
  });
});
