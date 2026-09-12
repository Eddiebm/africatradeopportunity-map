import { desc, eq, or } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { getOrCreateOrganization } from "../../../lib/org";
import {
  dealCosts,
  dealDocuments,
  dealEvents,
  deals,
  introductions,
  marketRequests,
  matchCandidates,
  milestones,
  notifications,
  quoteRequests,
  quotes,
  verificationChecks,
} from "../../../db/schema";

const checks = ["identity", "business", "buyer_authority", "stock", "payment", "vehicle_route", "customs_documents", "loading_inspection"];
const documents = ["commercial_invoice", "packing_list", "transport_waybill", "certificate_of_origin", "customs_declaration", "insurance_certificate", "product_specific_permit"];
const releases = [
  [1, "Contract", 10, "Signed contract and payment arrangement confirmed"],
  [2, "Verified loading", 40, "Independent loading evidence accepted"],
  [3, "Border clearance", 40, "Customs clearance evidence accepted"],
  [4, "Delivery acceptance", 10, "Delivery and buyer acceptance recorded"],
] as const;

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const db = getDb();
  const org = await getOrCreateOrganization(user);
  const [requests, offers] = await Promise.all([
    db.select().from(quoteRequests).where(or(
      eq(quoteRequests.requesterOrganizationId, org.id),
      eq(quoteRequests.recipientOrganizationId, org.id),
    )).orderBy(desc(quoteRequests.createdAt)).limit(100),
    db.select().from(quotes).orderBy(desc(quotes.createdAt)).limit(200),
  ]);
  return Response.json({
    quotes: requests.map((request) => ({
      ...request,
      mineIsRequester: request.requesterOrganizationId === org.id,
      quote: offers.find((row) => row.quoteRequestId === request.id) || null,
    })),
  });
}

export async function POST(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const body = await req.json() as Record<string, string | number>;
  const db = getDb();
  const org = await getOrCreateOrganization(user);
  const action = String(body.action || "");

  switch (action) {
    case "request": {
      const matchId = String(body.matchId || "");
      const [match] = await db.select().from(matchCandidates).where(eq(matchCandidates.id, matchId)).limit(1);
      if (!match) return Response.json({ error: "Match not found." }, { status: 404 });
      const [demand] = await db.select().from(marketRequests).where(eq(marketRequests.id, match.demandRequestId)).limit(1);
      const [supply] = await db.select().from(marketRequests).where(eq(marketRequests.id, match.supplyRequestId)).limit(1);
      if (!demand || !supply) return Response.json({ error: "Listings for this match are no longer available." }, { status: 409 });
      if (demand.ownerEmail !== user.email && supply.ownerEmail !== user.email) {
        return Response.json({ error: "Not authorized." }, { status: 403 });
      }
      const counterpartyEmail = demand.ownerEmail === user.email ? supply.ownerEmail : demand.ownerEmail;
      if (!counterpartyEmail) return Response.json({ error: "Counterparty has no account." }, { status: 409 });
      const recipient = await getOrCreateOrganization({ email: counterpartyEmail, displayName: counterpartyEmail, fullName: null });
      const id = `QR-${match.id}`;
      const [existing] = await db.select().from(quoteRequests).where(eq(quoteRequests.id, id)).limit(1);
      if (existing) return Response.json({ request: existing });
      const [created] = await db.insert(quoteRequests).values({
        id,
        matchId: match.id,
        requesterOrganizationId: org.id,
        recipientOrganizationId: recipient.id,
        quoteType: "goods",
        status: "requested",
        requirements: JSON.stringify({
          product: demand.product,
          origin: demand.origin,
          destination: demand.destination,
          volume: demand.volume,
        }),
      }).returning();
      await db.insert(notifications).values({
        recipientEmail: counterpartyEmail,
        eventType: "quote_requested",
        entityType: "match",
        entityId: demand.id,
        titleKey: "quote.requested.title",
        bodyKey: "quote.requested.body",
        payloadJson: JSON.stringify({ quoteRequestId: created.id }),
      });
      return Response.json({ request: created }, { status: 201 });
    }
    case "submit": {
      const quoteRequestId = String(body.quoteRequestId || "");
      const [request] = await db.select().from(quoteRequests).where(eq(quoteRequests.id, quoteRequestId)).limit(1);
      if (!request || request.recipientOrganizationId !== org.id) {
        return Response.json({ error: "You can only quote on requests sent to your desk." }, { status: 403 });
      }
      const unitPrice = Number(body.unitPrice || 0);
      const quantity = Number(body.quantity || 0);
      const validUntil = String(body.validUntil || "");
      if (unitPrice <= 0 || quantity <= 0 || !validUntil) {
        return Response.json({ error: "Provide a unit price, quantity and validity date." }, { status: 400 });
      }
      const [created] = await db.insert(quotes).values({
        id: `Q-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        quoteRequestId: request.id,
        submittedByOrganizationId: org.id,
        currency: String(body.currency || "USD"),
        unitPrice,
        quantity,
        unit: String(body.unit || "tonnes"),
        goodsTotal: unitPrice * quantity,
        freightTotal: Number(body.freightTotal || 0),
        validUntil,
        status: "submitted",
      }).returning();
      await db.update(quoteRequests).set({ status: "quoted", updatedAt: new Date().toISOString() }).where(eq(quoteRequests.id, request.id));
      if (request.matchId) {
        const [match] = await db.select().from(matchCandidates).where(eq(matchCandidates.id, request.matchId)).limit(1);
        if (match) {
          const [demand] = await db.select().from(marketRequests).where(eq(marketRequests.id, match.demandRequestId)).limit(1);
          if (demand?.ownerEmail) {
            await db.insert(notifications).values({
              recipientEmail: demand.ownerEmail,
              eventType: "quote_submitted",
              entityType: "match",
              entityId: demand.id,
              titleKey: "quote.submitted.title",
              bodyKey: "quote.submitted.body",
              payloadJson: JSON.stringify({ quoteId: created.id }),
            });
          }
        }
      }
      return Response.json({ quote: created }, { status: 201 });
    }
    case "accept": {
      const quoteId = String(body.quoteId || "");
      const [offer] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
      if (!offer) return Response.json({ error: "Quote not found." }, { status: 404 });
      const [request] = await db.select().from(quoteRequests).where(eq(quoteRequests.id, offer.quoteRequestId)).limit(1);
      if (!request || request.requesterOrganizationId !== org.id) {
        return Response.json({ error: "Only the requesting desk can accept this quote." }, { status: 403 });
      }
      if (new Date(offer.validUntil).getTime() < Date.now()) {
        return Response.json({ error: "This quote has expired." }, { status: 409 });
      }
      await db.update(quotes).set({ status: "accepted", updatedAt: new Date().toISOString() }).where(eq(quotes.id, offer.id));
      await db.update(quoteRequests).set({ status: "accepted", updatedAt: new Date().toISOString() }).where(eq(quoteRequests.id, request.id));
      if (request.matchId) {
        await db.update(matchCandidates).set({ status: "quoted", updatedAt: new Date().toISOString() }).where(eq(matchCandidates.id, request.matchId));
        await db.insert(introductions).values({
          id: `INT-${request.matchId}`,
          matchId: request.matchId,
          demandOrganizationId: request.requesterOrganizationId,
          supplyOrganizationId: request.recipientOrganizationId,
          demandConsentAt: new Date().toISOString(),
          supplyConsentAt: new Date().toISOString(),
          status: "quote_accepted",
        }).catch(() => undefined);
      }
      if (request.dealId) {
        const [existingDeal] = await db.select().from(deals).where(eq(deals.id, request.dealId)).limit(1);
        return Response.json({ quote: offer, deal: existingDeal });
      }
      const requirements = JSON.parse(request.requirements || "{}") as {
        product?: string;
        origin?: string;
        destination?: string;
        volume?: string;
      };
      const reference = `TS-${new Date().getUTCFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const [deal] = await db.insert(deals).values({
        reference,
        ownerEmail: user.email,
        requestType: "buy",
        product: requirements.product || "Quoted goods",
        origin: requirements.origin || "",
        destination: requirements.destination || "",
        quantity: offer.quantity,
        unit: offer.unit,
        stage: "quoted",
      }).returning();
      await db.insert(dealCosts).values({
        dealId: deal.id,
        supplierCost: offer.goodsTotal,
        expectedRevenue: offer.goodsTotal + offer.freightTotal,
        freight: offer.freightTotal,
      });
      await db.insert(verificationChecks).values(checks.map((checkType) => ({ dealId: deal.id, checkType })));
      await db.insert(dealDocuments).values(documents.map((documentType) => ({ dealId: deal.id, documentType })));
      await db.insert(milestones).values(releases.map(([sequence, name, percentage, releaseCondition]) => ({
        dealId: deal.id,
        sequence,
        name,
        percentage,
        releaseCondition,
      })));
      await db.insert(dealEvents).values({
        dealId: deal.id,
        actorEmail: user.email,
        eventType: "quote_accepted",
        summary: `Quote ${offer.id} accepted; deal room opened`,
      });
      await db.update(quoteRequests).set({ dealId: deal.id, updatedAt: new Date().toISOString() }).where(eq(quoteRequests.id, request.id));
      return Response.json({ quote: offer, deal }, { status: 201 });
    }
    default: {
      const _exhaustive: never = action as never;
      return Response.json({ error: "Unknown quote action.", detail: String(_exhaustive) }, { status: 400 });
    }
  }
}
