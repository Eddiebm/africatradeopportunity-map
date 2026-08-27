import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { dealEvents, deals, quoteRequests, quotes } from "../../../../db/schema";
import { requireUserOrResponse } from "../../../../lib/auth/current-user";

const ALLOWED = ["accepted", "declined"] as const;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUserOrResponse(request);
  if (auth instanceof Response) return auth;
  const user = auth;
  const quoteId = (await params).id;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const status = String(body.status ?? "") as (typeof ALLOWED)[number];
  if (!ALLOWED.includes(status)) return Response.json({ error: "Invalid status." }, { status: 400 });

  const db = getDb();
  const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
  if (!quote) return Response.json({ error: "Quote not found." }, { status: 404 });
  const [qr] = await db.select().from(quoteRequests).where(eq(quoteRequests.id, quote.quoteRequestId)).limit(1);
  if (!qr || !qr.dealId) return Response.json({ error: "Quote not found." }, { status: 404 });

  // Only the deal owner (who requested the quote through their
  // organization) can accept or decline it.
  const [deal] = await db.select().from(deals).where(and(eq(deals.id, qr.dealId), eq(deals.ownerEmail, user.email))).limit(1);
  if (!deal) return Response.json({ error: "Not authorized." }, { status: 403 });
  if (quote.status !== "submitted") return Response.json({ error: "This quote has already been decided." }, { status: 409 });
  if (status === "accepted" && new Date(quote.validUntil).getTime() <= Date.now()) {
    return Response.json({ error: "This quote has expired and can no longer be accepted." }, { status: 409 });
  }

  const now = new Date().toISOString();
  await db.update(quotes).set({ status, updatedAt: now }).where(eq(quotes.id, quoteId));
  if (status === "accepted") {
    await db.update(quoteRequests).set({ status: "accepted", updatedAt: now }).where(eq(quoteRequests.id, qr.id));
    const landed = quote.goodsTotal + quote.freightTotal + quote.borderEstimate + quote.inspectionTotal + quote.insuranceTotal + quote.financeFxTotal + quote.otherTotal;
    await db.insert(dealEvents).values({
      dealId: qr.dealId,
      actorEmail: user.email,
      eventType: "quote_accepted",
      summary: `Accepted a ${qr.quoteType} quote (${quote.currency} ${landed.toLocaleString()} landed) valid until ${quote.validUntil}`,
    });
  }

  return Response.json({ ok: true, status });
}
