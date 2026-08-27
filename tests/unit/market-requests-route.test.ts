// Priority 9 (docs/production-readiness.md): the low-friction quote
// request flow (app/quote/page.tsx). Proves the new role:"quote_request"
// path is genuinely low-friction (no auth, origin optional) while
// consent is genuinely mandatory, and that the PRE-EXISTING classifieds
// roles ("wanted"/"for_sale"/"freight_available") are unaffected — this
// route is shared, so a regression here would be silent everywhere else.
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import { marketRequests, organizationMembers, organizations, sessions, users } from "../../db/schema";
import { POST as marketRequestsPost } from "../../app/api/market-requests/route";
import { createSession, SESSION_COOKIE_NAME } from "../../lib/auth/session";

async function makeUser(email: string) {
  const db = getDb();
  const [row] = await db.insert(users).values({ email, passwordHash: "pbkdf2$sha256$1$AA$AA", displayName: "Test" }).returning({ id: users.id });
  return row.id;
}
function req(body: unknown, cookieValue?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (cookieValue) headers.set("cookie", `${SESSION_COOKIE_NAME}=${cookieValue}`);
  return new Request("http://localhost/api/market-requests", { method: "POST", headers, body: JSON.stringify(body) });
}

describe("POST /api/market-requests — role:quote_request (Priority 9)", () => {
  beforeEach(async () => {
    const db = getDb();
    await db.delete(marketRequests);
    await db.delete(organizationMembers);
    await db.delete(organizations);
    await db.delete(sessions);
    await db.delete(users);
  });

  it("an anonymous visitor can submit a quote request with NO origin and NO account — this is the whole point of the priority", async () => {
    const res = await marketRequestsPost(req({
      role: "quote_request", product: "Rice", destination: "Ghana", contact: "buyer@example.com",
      quantity: "20", unit: "tonnes", consent: "yes",
    }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { request: { id: number; status: string } };
    const [row] = await getDb().select().from(marketRequests).where(eq(marketRequests.id, body.request.id));
    expect(row.origin).toBe(""); // never fabricated — genuinely unset, not a guessed default
    expect(row.ownerEmail).toBeNull(); // truly anonymous, no account created
    expect(row.quantity).toBe(20);
    expect(row.unit).toBe("tonnes");
    expect(row.consentAt).not.toBeNull(); // a real timestamp, not just a boolean flag
  });

  it("REJECTS a quote_request with no consent — consent is mandatory, not optional metadata", async () => {
    const res = await marketRequestsPost(req({ role: "quote_request", product: "Rice", destination: "Ghana", contact: "buyer@example.com" }));
    expect(res.status).toBe(400);
  });

  it("still requires the base fields (product, destination, contact) even with consent given", async () => {
    const res = await marketRequestsPost(req({ role: "quote_request", consent: "yes", contact: "buyer@example.com" }));
    expect(res.status).toBe(400);
  });

  it("stores the full field set — spec, delivery date, existing quote note, preferred contact method", async () => {
    const res = await marketRequestsPost(req({
      role: "quote_request", product: "Rice", productSpec: "Grade A, 50kg bags", destination: "Ghana",
      requiredDeliveryDate: "2030-01-01", existingQuoteNote: "Supplier X quoted $400/tonne FOB", contact: "buyer@example.com",
      preferredContactMethod: "whatsapp", consent: "yes",
    }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { request: { id: number } };
    const [row] = await getDb().select().from(marketRequests).where(eq(marketRequests.id, body.request.id));
    expect(row.productSpec).toBe("Grade A, 50kg bags");
    expect(row.requiredDeliveryDate).toBe("2030-01-01");
    expect(row.existingQuoteNote).toBe("Supplier X quoted $400/tonne FOB");
    expect(row.preferredContactMethod).toBe("whatsapp");
  });

  it("REGRESSION: the pre-existing classifieds roles still require origin and volume, unchanged", async () => {
    const missingOrigin = await marketRequestsPost(req({ role: "wanted", product: "Rice", destination: "Ghana", volume: "20t", contact: "x@example.com" }));
    expect(missingOrigin.status).toBe(400);
    const ok = await marketRequestsPost(req({ role: "wanted", product: "Rice", origin: "Kenya", destination: "Ghana", volume: "20t", contact: "x@example.com" }));
    expect(ok.status).toBe(201);
  });

  it("REGRESSION: non-quote_request roles are NOT required to give consent (predate the concept)", async () => {
    const res = await marketRequestsPost(req({ role: "for_sale", product: "Rice", origin: "Kenya", destination: "Ghana", volume: "20t", contact: "x@example.com" }));
    expect(res.status).toBe(201);
  });

  it("a signed-in user's quote request still only attaches organizationId for a real, active membership", async () => {
    const userId = await makeUser("member@example.com");
    const { cookieValue } = await createSession(userId, {});
    const [org] = await getDb().insert(organizations).values({ ownerEmail: "member@example.com", legalName: "Real Org", country: "Ghana" }).returning();
    const res = await marketRequestsPost(req({
      role: "quote_request", product: "Rice", destination: "Ghana", contact: "member@example.com", consent: "yes",
      organizationId: String(org.id + 999), // NOT a real membership
    }, cookieValue));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { request: { id: number } };
    const [row] = await getDb().select().from(marketRequests).where(eq(marketRequests.id, body.request.id));
    expect(row.organizationId).toBeNull(); // attack: a claimed org id with no real membership is dropped, not trusted
    expect(row.ownerEmail).toBe("member@example.com");
  });

  it("an invalid/nonsense quantity is silently dropped rather than stored as a fabricated number", async () => {
    const res = await marketRequestsPost(req({ role: "quote_request", product: "Rice", destination: "Ghana", contact: "x@example.com", consent: "yes", quantity: "not-a-number" }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { request: { id: number } };
    const [row] = await getDb().select().from(marketRequests).where(eq(marketRequests.id, body.request.id));
    expect(row.quantity).toBeNull();
  });
});
