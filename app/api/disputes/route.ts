import { and, desc, eq } from "drizzle-orm";
import { requireUserOrResponse } from "../../../lib/auth/current-user";
import { getDb } from "../../../db";
import { dealEvents, deals, disputeEvents, disputes, notifications } from "../../../db/schema";

export async function GET(request: Request) {
  const auth = await requireUserOrResponse(request);
  if (auth instanceof Response) return auth;
  const user = auth;
  const rows = await getDb().select().from(disputes).where(eq(disputes.openedByEmail, user.email)).orderBy(desc(disputes.id)).limit(100);
  return Response.json({ disputes: rows });
}

export async function POST(req: Request) {
  const auth = await requireUserOrResponse(req);
  if (auth instanceof Response) return auth;
  const user = auth;
  try {
    const body = await req.json() as Record<string, string | number>;
    const dealId = Number(body.dealId), category = String(body.category || "").trim(), description = String(body.description || "").trim();
    if (!dealId || !category || description.length < 20) return Response.json({ error: "Choose a deal, category, and add at least 20 characters of detail." }, { status: 400 });
    const db = getDb();
    const [deal] = await db.select().from(deals).where(and(eq(deals.id, dealId), eq(deals.ownerEmail, user.email))).limit(1);
    if (!deal) return Response.json({ error: "Deal not found." }, { status: 404 });
    const reference = `DSP-${new Date().getUTCFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const [record] = await db.insert(disputes).values({ reference, dealId, openedByEmail: user.email, category, description, requestedResolution: String(body.requestedResolution || ""), disputedAmount: Number(body.disputedAmount || 0), currency: String(body.currency || deal.currency) }).returning();
    await db.insert(disputeEvents).values({ disputeId: record.id, actorEmail: user.email, eventType: "opened", summary: `Dispute opened for ${deal.reference}` });
    await db.insert(dealEvents).values({ dealId, actorEmail: user.email, eventType: "dispute_opened", summary: `${reference} opened; evidence review required` });
    await db.insert(notifications).values({ recipientEmail: user.email, eventType: "dispute_opened", entityType: "dispute", entityId: record.id, titleKey: "dispute.opened.title", bodyKey: "dispute.opened.body", status: "sent", sentAt: new Date().toISOString() });
    return Response.json({ dispute: record }, { status: 201 });
  } catch { return Response.json({ error: "The dispute could not be opened." }, { status: 500 }); }
}
