import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { organizationMembers, quoteRequests, quotes } from "../../../../../db/schema";
import { requireUserOrResponse } from "../../../../../lib/auth/current-user";

const NUMERIC_FIELDS = ["unitPrice", "quantity", "goodsTotal", "freightTotal", "borderEstimate", "inspectionTotal", "insuranceTotal", "financeFxTotal", "otherTotal"] as const;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUserOrResponse(request);
  if (auth instanceof Response) return auth;
  const user = auth;
  const quoteRequestId = (await params).id;

  const db = getDb();
  const [qr] = await db.select().from(quoteRequests).where(eq(quoteRequests.id, quoteRequestId)).limit(1);
  if (!qr) return Response.json({ error: "Quote request not found." }, { status: 404 });

  const [membership] = await db.select().from(organizationMembers).where(and(eq(organizationMembers.organizationId, qr.recipientOrganizationId), eq(organizationMembers.userId, user.id), eq(organizationMembers.status, "active"))).limit(1);
  if (!membership) return Response.json({ error: "Only a member of the organization this quote was requested from can respond." }, { status: 403 });
  if (qr.status !== "requested" && qr.status !== "quoted") {
    return Response.json({ error: "This quote request is no longer open." }, { status: 409 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const currency = String(body.currency ?? "").trim().toUpperCase();
  const unit = String(body.unit ?? "").trim();
  const validUntil = String(body.validUntil ?? "").trim();
  const assumptions = String(body.assumptions ?? "").trim().slice(0, 4000);
  if (!currency || currency.length > 6) return Response.json({ error: "Enter a valid currency code (e.g. USD)." }, { status: 400 });
  if (!validUntil) return Response.json({ error: "Set how long this quote is valid for." }, { status: 400 });
  if (new Date(validUntil).getTime() <= Date.now()) return Response.json({ error: "Validity date must be in the future." }, { status: 400 });
  if (!assumptions) {
    return Response.json({ error: "State the assumptions behind this quote — what it includes and excludes." }, { status: 400 });
  }

  const values: Record<string, number> = {};
  for (const field of NUMERIC_FIELDS) {
    const n = Number(body[field]);
    values[field] = Number.isFinite(n) && n >= 0 ? n : 0;
  }

  const id = `Q-${quoteRequestId}-${Date.now().toString(36).toUpperCase()}`;
  const [quote] = await db.insert(quotes).values({
    id,
    quoteRequestId,
    submittedByOrganizationId: qr.recipientOrganizationId,
    currency,
    unit,
    validUntil,
    assumptions,
    inclusions: JSON.stringify(Array.isArray(body.inclusions) ? body.inclusions : []),
    exclusions: JSON.stringify(Array.isArray(body.exclusions) ? body.exclusions : []),
    // A quote is what its submitting organization actually reported — not
    // an official or independently verified figure. Distinguishing this
    // from an "official" landed-cost source is the whole point of the
    // sourceStatus column; the default already reflects that correctly.
    unitPrice: values.unitPrice,
    quantity: values.quantity,
    goodsTotal: values.goodsTotal,
    freightTotal: values.freightTotal,
    borderEstimate: values.borderEstimate,
    inspectionTotal: values.inspectionTotal,
    insuranceTotal: values.insuranceTotal,
    financeFxTotal: values.financeFxTotal,
    otherTotal: values.otherTotal,
  }).returning();

  await db.update(quoteRequests).set({ status: "quoted", updatedAt: new Date().toISOString() }).where(eq(quoteRequests.id, quoteRequestId));

  return Response.json({ quote }, { status: 201 });
}
