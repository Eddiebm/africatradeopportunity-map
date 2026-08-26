import { desc, eq } from "drizzle-orm";
import { requirePlatformRoleOrResponse } from "../../../../lib/auth/current-user";
import { getDb } from "../../../../db";
import { adminAuditEvents, dealDocuments, deals, marketRequests, matchCandidates, verificationChecks } from "../../../../db/schema";

const REVIEWER_ROLES = ["administrator", "verification_analyst"] as const;

const allowed: Record<string, string[]> = {
  request: ["pending_verification", "contacted", "verified", "rejected"],
  deal: ["intake", "investigating", "quoted", "matched", "contracting", "in_transit", "delivered", "closed", "rejected"],
  check: ["required", "submitted", "verified", "failed"],
  document: ["required", "submitted", "approved", "rejected"],
  match: ["awaiting_counterparty", "mutual_interest", "approved", "rejected"],
};

export async function GET(request: Request) {
  const auth = await requirePlatformRoleOrResponse(request, [...REVIEWER_ROLES]);
  if (auth instanceof Response) return auth;
  const db = getDb();
  const [dealRows, requestRows, checks, documents, matches] = await Promise.all([
    db.select().from(deals).orderBy(desc(deals.id)).limit(100),
    db.select().from(marketRequests).orderBy(desc(marketRequests.id)).limit(100),
    db.select().from(verificationChecks).orderBy(desc(verificationChecks.id)).limit(300),
    db.select().from(dealDocuments).orderBy(desc(dealDocuments.id)).limit(300),
    db.select().from(matchCandidates).orderBy(desc(matchCandidates.createdAt)).limit(200),
  ]);
  return Response.json({ deals: dealRows, requests: requestRows, checks, documents, matches });
}

export async function PATCH(request: Request) {
  const auth = await requirePlatformRoleOrResponse(request, [...REVIEWER_ROLES]);
  if (auth instanceof Response) return auth;
  const admin = auth;

  const body = await request.json() as { entity?: string; id?: number | string; status?: string; reason?: string };
  const status = String(body.status || "");
  const reason = String(body.reason || "").trim();

  if (!body.entity || !allowed[body.entity]) return Response.json({ error: "Invalid record." }, { status: 400 });
  if (!reason) return Response.json({ error: "A reason is required for this decision." }, { status: 400 });
  if (!allowed[body.entity].includes(status)) return Response.json({ error: "Invalid status." }, { status: 400 });

  const db = getDb();

  // matchCandidates.id is a text primary key (e.g. "M-12-7"), not a numeric
  // row id — it must never be coerced through Number()/numericId, unlike
  // every other entity type handled below. See docs/AUDIT.md §3.
  if (body.entity === "match") {
    const matchId = String(body.id ?? "").trim();
    if (!matchId) return Response.json({ error: "Invalid record." }, { status: 400 });
    const [row] = await db.select().from(matchCandidates).where(eq(matchCandidates.id, matchId)).limit(1);
    if (!row) return Response.json({ error: "Invalid record." }, { status: 400 });
    await db.update(matchCandidates).set({ status, updatedAt: new Date().toISOString() }).where(eq(matchCandidates.id, matchId));
    await db.insert(adminAuditEvents).values({
      actorUserId: admin.id,
      action: "status_change",
      entityType: "match",
      // adminAuditEvents.entityId is integer-only; the match's real id is
      // the text id above (already used for the update's WHERE clause).
      // We log the demand request id here as the closest available
      // integer FK — see final report for the Phase 2 follow-up this implies.
      entityId: row.demandRequestId,
      fromStatus: row.status,
      toStatus: status,
      reason,
    });
    return Response.json({ ok: true });
  }

  const numericId = Number(body.id);
  if (!numericId) return Response.json({ error: "Invalid record." }, { status: 400 });

  if (body.entity === "request") {
    const [row] = await db.select().from(marketRequests).where(eq(marketRequests.id, numericId)).limit(1);
    if (!row) return Response.json({ error: "Invalid record." }, { status: 400 });
    await db.update(marketRequests).set({ status }).where(eq(marketRequests.id, numericId));
    await db.insert(adminAuditEvents).values({ actorUserId: admin.id, action: "status_change", entityType: "request", entityId: numericId, fromStatus: row.status, toStatus: status, reason });
  } else if (body.entity === "deal") {
    const [row] = await db.select().from(deals).where(eq(deals.id, numericId)).limit(1);
    if (!row) return Response.json({ error: "Invalid record." }, { status: 400 });
    await db.update(deals).set({ stage: status, updatedAt: new Date().toISOString() }).where(eq(deals.id, numericId));
    await db.insert(adminAuditEvents).values({ actorUserId: admin.id, action: "status_change", entityType: "deal", entityId: numericId, fromStatus: row.stage, toStatus: status, reason });
  } else if (body.entity === "check") {
    const [row] = await db.select().from(verificationChecks).where(eq(verificationChecks.id, numericId)).limit(1);
    if (!row) return Response.json({ error: "Invalid record." }, { status: 400 });
    await db.update(verificationChecks).set({ status, reviewerEmail: admin.email, checkedAt: new Date().toISOString() }).where(eq(verificationChecks.id, numericId));
    await db.insert(adminAuditEvents).values({ actorUserId: admin.id, action: "status_change", entityType: "check", entityId: numericId, fromStatus: row.status, toStatus: status, reason });
  } else if (body.entity === "document") {
    const [row] = await db.select().from(dealDocuments).where(eq(dealDocuments.id, numericId)).limit(1);
    if (!row) return Response.json({ error: "Invalid record." }, { status: 400 });
    await db.update(dealDocuments).set({ status, reviewedBy: admin.email, reviewedAt: new Date().toISOString() }).where(eq(dealDocuments.id, numericId));
    await db.insert(adminAuditEvents).values({ actorUserId: admin.id, action: "status_change", entityType: "document", entityId: numericId, fromStatus: row.status, toStatus: status, reason });
  } else {
    return Response.json({ error: "Invalid record." }, { status: 400 });
  }

  return Response.json({ ok: true });
}
