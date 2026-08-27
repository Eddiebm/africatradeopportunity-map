import { desc, eq } from "drizzle-orm";
import { requireUserOrResponse, type SessionUser } from "../../../lib/auth/current-user";
import { withIdempotency } from "../../../lib/idempotency";
import { getDb } from "../../../db";
import { dealCosts, dealDocuments, dealEvents, deals, milestones, verificationChecks } from "../../../db/schema";

const checks = ["identity", "business", "buyer_authority", "stock", "payment", "vehicle_route", "customs_documents", "loading_inspection"];
const documents = ["commercial_invoice", "packing_list", "transport_waybill", "certificate_of_origin", "customs_declaration", "insurance_certificate", "product_specific_permit"];
const releases = [
  [1, "Contract", 10, "Signed contract and payment arrangement confirmed"],
  [2, "Verified loading", 40, "Independent loading evidence accepted"],
  [3, "Border clearance", 40, "Customs clearance evidence accepted"],
  [4, "Delivery acceptance", 10, "Delivery and buyer acceptance recorded"],
] as const;

export async function GET(request: Request) {
  const auth = await requireUserOrResponse(request);
  if (auth instanceof Response) return auth;
  const user = auth;
  const rows = await getDb().select().from(deals).where(eq(deals.ownerEmail, user.email)).orderBy(desc(deals.id)).limit(100);
  return Response.json({ deals: rows });
}

export async function POST(req: Request) {
  const auth = await requireUserOrResponse(req);
  if (auth instanceof Response) return auth;
  const user = auth;
  // docs/AUDIT.md §5 item 8: without this, a retried POST (double-click,
  // a client retrying a dropped response) created a second deal room —
  // see lib/idempotency.ts for exactly what this does and does not cover.
  return await withIdempotency(req, user, "POST /api/deals", () => createDeal(req, user));
}

async function createDeal(req: Request, user: SessionUser) {
  try {
    const body = await req.json() as Record<string, string | number>;
    const required = ["requestType", "product", "origin", "destination"];
    if (required.some((key) => !String(body[key] ?? "").trim())) {
      return Response.json({ error: "Complete the product, origin, destination and request type." }, { status: 400 });
    }
    const reference = `TS-${new Date().getUTCFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const db = getDb();
    const [deal] = await db.insert(deals).values({
      reference,
      ownerEmail: user.email,
      requestType: String(body.requestType),
      product: String(body.product),
      hsCode: String(body.hsCode ?? ""),
      origin: String(body.origin),
      destination: String(body.destination),
      quantity: Number(body.quantity || 0),
      unit: String(body.unit || "tonnes"),
      currency: String(body.currency || "USD"),
      targetDate: String(body.targetDate || ""),
    }).returning();

    await db.insert(dealCosts).values({
      dealId: deal.id,
      supplierCost: Number(body.supplierCost || 0),
      expectedRevenue: Number(body.expectedRevenue || 0),
      freight: Number(body.freight || 0),
      borderTaxes: Number(body.borderTaxes || 0),
      financeFx: Number(body.financeFx || 0),
      lossPercent: Number(body.lossPercent || 0),
    });
    await db.insert(verificationChecks).values(checks.map((checkType) => ({ dealId: deal.id, checkType })));
    await db.insert(dealDocuments).values(documents.map((documentType) => ({ dealId: deal.id, documentType })));
    await db.insert(milestones).values(releases.map(([sequence, name, percentage, releaseCondition]) => ({ dealId: deal.id, sequence, name, percentage, releaseCondition })));
    await db.insert(dealEvents).values({ dealId: deal.id, actorEmail: user.email, eventType: "deal_created", summary: `${body.product} request opened for ${body.origin} → ${body.destination}` });
    return Response.json({ deal }, { status: 201 });
  } catch {
    return Response.json({ error: "The deal desk could not create this record." }, { status: 500 });
  }
}
