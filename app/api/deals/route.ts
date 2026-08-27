import { desc, eq } from "drizzle-orm";
import { requireUserOrResponse, type SessionUser } from "../../../lib/auth/current-user";
import { withIdempotency } from "../../../lib/idempotency";
import { corridorKeyFor, getCurrentTemplate } from "../../../lib/corridor-templates";
import { DEAL_STAGES } from "../../../lib/deal-workflow";
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
    const origin = String(body.origin);
    const destination = String(body.destination);
    // Priority 5 (docs/production-readiness.md): "Historical deals must
    // retain the corridor-template version under which they were
    // created." Attached at creation time, permanently — later template
    // edits create a NEW version row (see lib/corridor-templates.ts) and
    // never touch this deal's reference to the version that applied when
    // it was opened. Nullable and silent when no template exists yet —
    // most corridors have none (see app/corridors/page.tsx's
    // "intelligence coverage" tier), and that's not an error.
    const corridorTemplate = await getCurrentTemplate(corridorKeyFor(origin, destination));
    const [deal] = await db.insert(deals).values({
      reference,
      ownerEmail: user.email,
      requestType: String(body.requestType),
      product: String(body.product),
      hsCode: String(body.hsCode ?? ""),
      origin,
      destination,
      quantity: Number(body.quantity || 0),
      unit: String(body.unit || "tonnes"),
      currency: String(body.currency || "USD"),
      targetDate: String(body.targetDate || ""),
      corridorTemplateId: corridorTemplate?.id ?? null,
      // Priority 7 (docs/production-readiness.md): explicit rather than
      // relying on the column default (see db/schema.ts's comment on
      // why that default is stuck at the old "intake" value) —
      // DEAL_STAGES[0] is the actual first stage of the real state
      // machine every deal now enters.
      stage: DEAL_STAGES[0],
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
    // Priority 8 (docs/production-readiness.md): "overdue milestones" needs
    // a real deadline. The ONLY one this platform can honestly set without
    // fabricating precision is the final "Delivery acceptance" milestone
    // (sequence 4) — it's a direct 1:1 mapping to the deal's own reported
    // targetDate, not an invented intermediate schedule. Every other
    // milestone's dueAt stays null (never "overdue") until a reviewer sets
    // one explicitly via app/api/admin/milestones/[id]/schedule/route.ts.
    const deliveryDueAt = body.targetDate && !Number.isNaN(Date.parse(String(body.targetDate))) ? new Date(String(body.targetDate)).toISOString() : null;
    const now = new Date().toISOString();
    await db.insert(milestones).values(
      releases.map(([sequence, name, percentage, releaseCondition]) => ({
        dealId: deal.id,
        sequence,
        name,
        percentage,
        releaseCondition,
        createdAt: now,
        dueAt: sequence === 4 ? deliveryDueAt : null,
      })),
    );
    await db.insert(dealEvents).values({ dealId: deal.id, actorEmail: user.email, eventType: "deal_created", summary: `${body.product} request opened for ${body.origin} → ${body.destination}` });
    return Response.json({ deal }, { status: 201 });
  } catch {
    return Response.json({ error: "The deal desk could not create this record." }, { status: 500 });
  }
}
