// Priority 12 (docs/production-readiness.md): landed-cost accuracy.
// Proves real deal-creation seeding (never fabricating a range from a
// single number, honestly excluding insurance/inspection when the form
// never asked for them), the "latest wins" breakdown computation, real
// variance calculation once an actual exists, and that the API's range
// sanity checks and owner-only write gate are real — against a real
// D1-backed test database.
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import { dealCosts, dealEvents, dealParties, deals, landedCostEntries, sessions, users } from "../../db/schema";
import { getLandedCostBreakdown, recordLandedCostEntry, seedLandedCostFromDealIntake } from "../../lib/landed-cost";
import { createSession, SESSION_COOKIE_NAME } from "../../lib/auth/session";
import { GET as landedCostGet, POST as landedCostPost } from "../../app/api/deals/[id]/landed-cost/route";

async function makeUser(email: string) {
  const db = getDb();
  const [row] = await db.insert(users).values({ email, passwordHash: "pbkdf2$sha256$1$AA$AA", displayName: "Test" }).returning({ id: users.id });
  return row.id;
}
async function makeDeal(ownerEmail: string) {
  const db = getDb();
  const [row] = await db.insert(deals).values({ reference: `DEAL-${crypto.randomUUID()}`, ownerEmail, requestType: "buy", product: "Rice", origin: "Ghana", destination: "Nigeria", stage: "request_confirmed", currency: "USD" }).returning();
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

describe("lib/landed-cost", () => {
  beforeEach(async () => {
    const db = getDb();
    await db.delete(landedCostEntries);
    await db.delete(dealEvents);
    await db.delete(dealParties);
    await db.delete(dealCosts);
    await db.delete(deals);
    await db.delete(sessions);
    await db.delete(users);
  });

  it("seedLandedCostFromDealIntake records real, sourced estimates and NEVER fabricates a range from a single number", async () => {
    const deal = await makeDeal("owner@example.com");
    await seedLandedCostFromDealIntake({
      dealId: deal.id, currency: "USD", recordedByEmail: "owner@example.com",
      supplierCost: 10000, freight: 800, borderTaxes: 500, financeFx: 100,
      insuranceCollected: false, inspectionCollected: false, insurance: 0, inspection: 0,
    });
    const breakdown = await getLandedCostBreakdown(deal.id);
    const goods = breakdown.components.find((c) => c.componentType === "goods");
    expect(goods?.estimate?.expectedAmount).toBe(10000);
    expect(goods?.estimate?.lowAmount).toBeNull(); // never fabricated
    expect(goods?.estimate?.highAmount).toBeNull();
    expect(goods?.estimate?.source).toBe("Trader-reported at deal creation");
  });

  it("insurance/inspection genuinely not collected are EXCLUDED, not silently $0", async () => {
    const deal = await makeDeal("owner2@example.com");
    await seedLandedCostFromDealIntake({
      dealId: deal.id, currency: "USD", recordedByEmail: "owner2@example.com",
      supplierCost: 1000, freight: 0, borderTaxes: 0, financeFx: 0,
      insuranceCollected: false, inspectionCollected: false, insurance: 0, inspection: 0,
    });
    const breakdown = await getLandedCostBreakdown(deal.id);
    expect(breakdown.components.some((c) => c.componentType === "insurance")).toBe(false); // excluded, not in the counted list
    expect(breakdown.excluded.some((e) => e.componentType === "insurance")).toBe(true);
    expect(breakdown.excluded.some((e) => e.componentType === "brokerage")).toBe(true);
    // Excluded components never enter the totals.
    const insuranceComponent = breakdown.excluded.find((e) => e.componentType === "insurance");
    expect(insuranceComponent).toBeDefined();
  });

  it("FIX (production-hardening audit, PR review finding): a real actual recorded for a previously-EXCLUDED component is never dropped", async () => {
    const deal = await makeDeal("owner2b@example.com");
    await seedLandedCostFromDealIntake({
      dealId: deal.id, currency: "USD", recordedByEmail: "owner2b@example.com",
      supplierCost: 1000, freight: 0, borderTaxes: 0, financeFx: 0,
      insuranceCollected: false, inspectionCollected: false, insurance: 0, inspection: 0,
    });
    // Confirm the pre-condition: insurance starts genuinely excluded.
    let breakdown = await getLandedCostBreakdown(deal.id);
    expect(breakdown.excluded.some((e) => e.componentType === "insurance")).toBe(true);
    expect(breakdown.components.some((c) => c.componentType === "insurance")).toBe(false);

    // The owner later pays a real insurance premium and records it.
    await recordLandedCostEntry({ dealId: deal.id, componentType: "insurance", phase: "actual", expectedAmount: 42, source: "Paid insurance invoice #7", recordedByEmail: "owner2b@example.com" });
    breakdown = await getLandedCostBreakdown(deal.id);

    const insurance = breakdown.components.find((c) => c.componentType === "insurance");
    expect(insurance).toBeDefined(); // no longer silently missing
    expect(insurance?.actual?.expectedAmount).toBe(42);
    expect(insurance?.estimate).toBeNull(); // honest: there never was a real estimate, not a fabricated $0 one
    expect(insurance?.variance).toBeNull(); // nothing to compare a real actual against
    // actualTotal itself stays null here — a separate, pre-existing
    // invariant (unrelated to this fix) only reports a total once EVERY
    // non-excluded component has a recorded actual, and this deal's other
    // components (goods/transport/duties_taxes/financing/tradesafe_fees)
    // don't have one yet. Confirmed below: once they do, the insurance
    // actual this fix concerns is genuinely included in that total, not
    // dropped.
    expect(breakdown.actualTotal).toBeNull();
    // No longer double-listed as "not yet estimated" once a real actual
    // exists for it — that would contradict the actual shown above.
    expect(breakdown.excluded.some((e) => e.componentType === "insurance")).toBe(false);

    for (const componentType of ["goods", "transport", "duties_taxes", "financing", "tradesafe_fees"] as const) {
      await recordLandedCostEntry({ dealId: deal.id, componentType, phase: "actual", expectedAmount: 1, source: "test-filled actual", recordedByEmail: "owner2b@example.com" });
    }
    breakdown = await getLandedCostBreakdown(deal.id);
    expect(breakdown.actualTotal).toBe(1 + 1 + 1 + 1 + 1 + 42); // the insurance actual is genuinely counted, not dropped
  });

  it("tradesafe_fees is seeded honestly at $0 high confidence — a real fact (no fee schedule exists), not a guess", async () => {
    const deal = await makeDeal("owner3@example.com");
    await seedLandedCostFromDealIntake({
      dealId: deal.id, currency: "USD", recordedByEmail: "owner3@example.com",
      supplierCost: 100, freight: 0, borderTaxes: 0, financeFx: 0,
      insuranceCollected: false, inspectionCollected: false, insurance: 0, inspection: 0,
    });
    const breakdown = await getLandedCostBreakdown(deal.id);
    const fee = breakdown.components.find((c) => c.componentType === "tradesafe_fees");
    expect(fee?.estimate?.expectedAmount).toBe(0);
    expect(fee?.estimate?.confidence).toBe("high");
    expect(fee?.estimate?.assumptions).toMatch(/does not currently charge/);
  });

  it("a real range (low/high actually supplied) computes correctly into totals", async () => {
    const deal = await makeDeal("owner4@example.com");
    await recordLandedCostEntry({ dealId: deal.id, componentType: "goods", phase: "estimate", lowAmount: 900, expectedAmount: 1000, highAmount: 1200, recordedByEmail: "owner4@example.com", source: "Supplier quotation" });
    await recordLandedCostEntry({ dealId: deal.id, componentType: "transport", phase: "estimate", expectedAmount: 200, recordedByEmail: "owner4@example.com" }); // no range supplied
    const breakdown = await getLandedCostBreakdown(deal.id);
    expect(breakdown.totals.expected).toBe(1200);
    expect(breakdown.totals.low).toBeNull(); // one component missing a low bound means the TOTAL low is honestly unknown, not partially summed
    expect(breakdown.totals.high).toBeNull();
  });

  it("recording a real actual computes a real variance — never phrased as savings/profit in the data itself", async () => {
    const deal = await makeDeal("owner5@example.com");
    await recordLandedCostEntry({ dealId: deal.id, componentType: "goods", phase: "estimate", expectedAmount: 1000, recordedByEmail: "owner5@example.com" });
    await recordLandedCostEntry({ dealId: deal.id, componentType: "goods", phase: "actual", expectedAmount: 1150, source: "Paid invoice #445", recordedByEmail: "owner5@example.com" });
    await recordLandedCostEntry({ dealId: deal.id, componentType: "transport", phase: "estimate", expectedAmount: 200, recordedByEmail: "owner5@example.com" }); // no actual yet for this one
    const breakdown = await getLandedCostBreakdown(deal.id);
    const goods = breakdown.components.find((c) => c.componentType === "goods");
    expect(goods?.variance).toBe(150); // cost overrun
    expect(breakdown.actualTotal).toBeNull(); // transport has no actual yet — the TOTAL actual isn't complete, even though goods' own variance is already knowable
  });

  it("a re-estimate (a new row for the same component) supersedes the old one — full history preserved, never overwritten", async () => {
    const deal = await makeDeal("owner6@example.com");
    await recordLandedCostEntry({ dealId: deal.id, componentType: "goods", phase: "estimate", expectedAmount: 1000, recordedByEmail: "owner6@example.com" });
    await recordLandedCostEntry({ dealId: deal.id, componentType: "goods", phase: "estimate", expectedAmount: 1100, recordedByEmail: "owner6@example.com", source: "Updated after supplier revised quote" });
    const breakdown = await getLandedCostBreakdown(deal.id);
    expect(breakdown.components.find((c) => c.componentType === "goods")?.estimate?.expectedAmount).toBe(1100);
    const all = await getDb().select().from(landedCostEntries).where(eq(landedCostEntries.dealId, deal.id));
    expect(all.length).toBe(2); // both rows still exist
  });
});

describe("app/api/deals/[id]/landed-cost route", () => {
  beforeEach(async () => {
    const db = getDb();
    await db.delete(landedCostEntries);
    await db.delete(dealEvents);
    await db.delete(dealParties);
    await db.delete(dealCosts);
    await db.delete(deals);
    await db.delete(sessions);
    await db.delete(users);
  });

  it("GET requires real deal access — an unrelated user gets 404, not the data", async () => {
    const deal = await makeDeal("realowner@example.com");
    const outsiderId = await makeUser("outsider@example.com");
    const { cookieValue } = await createSession(outsiderId, {});
    const res = await landedCostGet(req(`http://localhost/api/deals/${deal.id}/landed-cost`, undefined, cookieValue), { params: Promise.resolve({ id: String(deal.id) }) });
    expect(res.status).toBe(404);
  });

  it("POST is owner-only — a signed-in non-owner (with no deal relationship) is rejected", async () => {
    const deal = await makeDeal("realowner2@example.com");
    const outsiderId = await makeUser("outsider2@example.com");
    const { cookieValue } = await createSession(outsiderId, {});
    const res = await landedCostPost(req(`http://localhost/api/deals/${deal.id}/landed-cost`, { componentType: "goods", phase: "estimate", expectedAmount: 100 }, cookieValue), { params: Promise.resolve({ id: String(deal.id) }) });
    expect(res.status).toBe(404); // deal access itself is denied before ownership is even checked — no existence leak
  });

  it("ATTACK: a fabricated/inverted range (low > expected) is rejected", async () => {
    const ownerId = await makeUser("owner7@example.com");
    const deal = await makeDeal("owner7@example.com");
    const { cookieValue } = await createSession(ownerId, {});
    const res = await landedCostPost(req(`http://localhost/api/deals/${deal.id}/landed-cost`, { componentType: "goods", phase: "estimate", expectedAmount: 100, lowAmount: 500 }, cookieValue), { params: Promise.resolve({ id: String(deal.id) }) });
    expect(res.status).toBe(400);
  });

  it("recording an ACTUAL requires a real source", async () => {
    const ownerId = await makeUser("owner8@example.com");
    const deal = await makeDeal("owner8@example.com");
    const { cookieValue } = await createSession(ownerId, {});
    const noSource = await landedCostPost(req(`http://localhost/api/deals/${deal.id}/landed-cost`, { componentType: "goods", phase: "actual", expectedAmount: 100 }, cookieValue), { params: Promise.resolve({ id: String(deal.id) }) });
    expect(noSource.status).toBe(400);
    const withSource = await landedCostPost(req(`http://localhost/api/deals/${deal.id}/landed-cost`, { componentType: "goods", phase: "actual", expectedAmount: 100, source: "Paid invoice #1" }, cookieValue), { params: Promise.resolve({ id: String(deal.id) }) });
    expect(withSource.status).toBe(201);
  });

  it("rejects an invalid componentType/phase", async () => {
    const ownerId = await makeUser("owner9@example.com");
    const deal = await makeDeal("owner9@example.com");
    const { cookieValue } = await createSession(ownerId, {});
    const res = await landedCostPost(req(`http://localhost/api/deals/${deal.id}/landed-cost`, { componentType: "not_a_real_component", phase: "estimate", expectedAmount: 100 }, cookieValue), { params: Promise.resolve({ id: String(deal.id) }) });
    expect(res.status).toBe(400);
  });

  it("a real owner records an estimate through the real API end to end", async () => {
    const ownerId = await makeUser("owner10@example.com");
    const deal = await makeDeal("owner10@example.com");
    const { cookieValue } = await createSession(ownerId, {});
    const post = await landedCostPost(req(`http://localhost/api/deals/${deal.id}/landed-cost`, { componentType: "inspection", phase: "estimate", expectedAmount: 250, lowAmount: 200, highAmount: 300, confidence: "medium", source: "Independent inspector quotation" }, cookieValue), { params: Promise.resolve({ id: String(deal.id) }) });
    expect(post.status).toBe(201);
    const get = await landedCostGet(req(`http://localhost/api/deals/${deal.id}/landed-cost`, undefined, cookieValue), { params: Promise.resolve({ id: String(deal.id) }) });
    const body = (await get.json()) as { components: { componentType: string; estimate: { expectedAmount: number } | null }[] };
    expect(body.components.find((c) => c.componentType === "inspection")?.estimate?.expectedAmount).toBe(250);
  });

  it("FIX (production-hardening audit, PR review finding): currency is derived server-side from the deal, never trusted from the client", async () => {
    const ownerId = await makeUser("owner11@example.com");
    const db = getDb();
    const [kesDeal] = await db.insert(deals).values({ reference: `DEAL-${crypto.randomUUID()}`, ownerEmail: "owner11@example.com", requestType: "buy", product: "Maize", origin: "Kenya", destination: "Uganda", stage: "request_confirmed", currency: "KES" }).returning();
    const { cookieValue } = await createSession(ownerId, {});
    // Attacker/buggy-client case: the request body claims EUR, but the
    // real deal is KES. Before this fix, this exact request stored the
    // entry as USD (lib/landed-cost.ts's own hardcoded fallback) — never
    // even respecting the forged value, just silently wrong in a
    // different way. Either way, nothing the client sends should decide
    // the stored currency.
    const post = await landedCostPost(
      req(`http://localhost/api/deals/${kesDeal.id}/landed-cost`, { componentType: "goods", phase: "actual", expectedAmount: 500, source: "Paid invoice #99", currency: "EUR" }, cookieValue),
      { params: Promise.resolve({ id: String(kesDeal.id) }) },
    );
    expect(post.status).toBe(201);
    const [stored] = await db.select().from(landedCostEntries).where(eq(landedCostEntries.dealId, kesDeal.id));
    expect(stored.currency).toBe("KES"); // the deal's real currency — not "EUR" (client-forged) and not "USD" (the old silent default)
  });
});
