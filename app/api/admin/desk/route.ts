import { desc, eq } from "drizzle-orm";
import { requirePlatformRoleOrResponse } from "../../../../lib/auth/current-user";
import { getDb } from "../../../../db";
import { adminAuditEvents, dealDocuments, deals, introductions, marketRequests, matchCandidates, milestones, organizations, verificationChecks } from "../../../../db/schema";

const REVIEWER_ROLES = ["administrator", "verification_analyst"] as const;

const allowed: Record<string, string[]> = {
  request: ["pending_verification", "contacted", "verified", "rejected"],
  deal: ["intake", "investigating", "quoted", "matched", "contracting", "in_transit", "delivered", "closed", "rejected"],
  check: ["required", "submitted", "verified", "failed"],
  document: ["required", "submitted", "approved", "rejected"],
  match: ["awaiting_counterparty", "mutual_interest", "approved", "rejected"],
  organization: ["reported", "under_review", "verified", "rejected"],
  introduction: ["awaiting_consent", "pending_review", "approved", "rejected"],
  // Evidence state only — see app/api/deals/[id]/milestones/[milestoneId]/route.ts.
  // Marking a milestone "verified" here confirms the evidence was reviewed;
  // it does not move money. milestones.status (proposed/etc.) is untouched
  // by this — a licensed payment partner, not this platform, executes any
  // actual release.
  milestone: ["missing", "submitted", "verified"],
};

export async function GET(request: Request) {
  const auth = await requirePlatformRoleOrResponse(request, [...REVIEWER_ROLES]);
  if (auth instanceof Response) return auth;
  const db = getDb();
  const [dealRows, requestRows, checks, documents, matches, organizationRows, introductionRows, milestoneRows] = await Promise.all([
    db.select().from(deals).orderBy(desc(deals.id)).limit(100),
    db.select().from(marketRequests).orderBy(desc(marketRequests.id)).limit(100),
    db.select().from(verificationChecks).orderBy(desc(verificationChecks.id)).limit(300),
    db.select().from(dealDocuments).orderBy(desc(dealDocuments.id)).limit(300),
    db.select().from(matchCandidates).orderBy(desc(matchCandidates.createdAt)).limit(200),
    db.select().from(organizations).orderBy(desc(organizations.id)).limit(200),
    db.select().from(introductions).orderBy(desc(introductions.createdAt)).limit(200),
    db.select().from(milestones).where(eq(milestones.evidenceStatus, "submitted")).limit(200),
  ]);
  return Response.json({ deals: dealRows, requests: requestRows, checks, documents, matches, organizations: organizationRows, introductions: introductionRows, milestones: milestoneRows });
}

export async function PATCH(request: Request) {
  const auth = await requirePlatformRoleOrResponse(request, [...REVIEWER_ROLES]);
  if (auth instanceof Response) return auth;
  const admin = auth;

  let body: { entity?: string; id?: number | string; status?: string; reason?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const status = String(body.status || "");
  const reason = String(body.reason || "").trim();

  if (!body.entity || !allowed[body.entity]) return Response.json({ error: "Invalid record." }, { status: 400 });
  if (!reason) return Response.json({ error: "A reason is required for this decision." }, { status: 400 });
  if (!allowed[body.entity].includes(status)) return Response.json({ error: "Invalid status." }, { status: 400 });

  const db = getDb();

  // introductions.id is also a text primary key (e.g. "I-M-12-7"), same
  // reason as matchCandidates below — never coerced through numericId.
  if (body.entity === "introduction") {
    const introId = String(body.id ?? "").trim();
    if (!introId) return Response.json({ error: "Invalid record." }, { status: 400 });
    const [row] = await db.select().from(introductions).where(eq(introductions.id, introId)).limit(1);
    if (!row) return Response.json({ error: "Invalid record." }, { status: 400 });
    const now = new Date().toISOString();
    const isApproval = status === "approved";
    await db
      .update(introductions)
      .set({
        status,
        updatedAt: now,
        ...(isApproval ? { approvedBy: admin.email, approvedAt: now, contactReleasedAt: now } : {}),
      })
      .where(eq(introductions.id, introId));
    await db.insert(adminAuditEvents).values({
      actorUserId: admin.id,
      action: "status_change",
      entityType: "introduction",
      // Same integer-only entityId constraint as the match branch below —
      // logging the demand organization id as the closest available FK.
      entityId: row.demandOrganizationId,
      fromStatus: row.status,
      toStatus: status,
      reason,
    });
    return Response.json({ ok: true });
  }

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
  } else if (body.entity === "organization") {
    const [row] = await db.select().from(organizations).where(eq(organizations.id, numericId)).limit(1);
    if (!row) return Response.json({ error: "Invalid record." }, { status: 400 });
    await db.update(organizations).set({ verificationStatus: status }).where(eq(organizations.id, numericId));
    await db.insert(adminAuditEvents).values({ actorUserId: admin.id, action: "status_change", entityType: "organization", entityId: numericId, fromStatus: row.verificationStatus, toStatus: status, reason });
  } else if (body.entity === "milestone") {
    const [row] = await db.select().from(milestones).where(eq(milestones.id, numericId)).limit(1);
    if (!row) return Response.json({ error: "Invalid record." }, { status: 400 });
    await db.update(milestones).set({ evidenceStatus: status }).where(eq(milestones.id, numericId));
    await db.insert(adminAuditEvents).values({ actorUserId: admin.id, action: "status_change", entityType: "milestone", entityId: numericId, fromStatus: row.evidenceStatus, toStatus: status, reason });
  } else {
    return Response.json({ error: "Invalid record." }, { status: 400 });
  }

  return Response.json({ ok: true });
}
