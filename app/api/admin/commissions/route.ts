import { desc, eq, inArray } from "drizzle-orm";
import { requirePlatformRoleOrResponse } from "../../../../lib/auth/current-user";
import { getDb } from "../../../../db";
import { adminAuditEvents, commissionRecords, deals, organizations, referralAttributions, COMMISSION_BASES, COMMISSION_STATUSES, referralPartners } from "../../../../db/schema";

const REVIEWER_ROLES = ["administrator", "verification_analyst"] as const;

// Priority 11 (docs/production-readiness.md): "commission records/status
// ... don't pay commissions until legal/accounting requirements are
// defined — may track pending/approved obligations without transferring
// money." This route can create, approve, dispute, or waive a tracked
// obligation. It CANNOT mark one paid — COMMISSION_STATUSES has no such
// value (see db/schema.ts), so there is no status string this route
// could even validate a "paid" transition against, let alone execute one.
export async function GET(request: Request) {
  const auth = await requirePlatformRoleOrResponse(request, [...REVIEWER_ROLES]);
  if (auth instanceof Response) return auth;
  const db = getDb();
  const [records, partners, attributions] = await Promise.all([
    db.select().from(commissionRecords).orderBy(desc(commissionRecords.id)).limit(200),
    db.select().from(referralPartners).orderBy(desc(referralPartners.id)).limit(200),
    // Deliberately NOT filtered to isPrimary — a fraud-flagged attribution
    // (self-referral, duplicate) is BY DEFINITION never primary, so
    // filtering here would hide from reviewers exactly the rows fraud
    // review needs to see. (app/api/referrals/route.ts's own GET, by
    // contrast, correctly filters to primary-only there — that's an
    // org's own "how many referees actually counted" performance stat,
    // a different real question.)
    db.select().from(referralAttributions).orderBy(desc(referralAttributions.id)).limit(200),
  ]);
  // Real joins for a usable admin view — a bare referralPartnerId/dealId
  // means nothing to a reviewer deciding whether to approve an obligation.
  const orgIds = [...new Set(partners.map((p) => p.organizationId))];
  const dealIds = [...new Set(records.map((r) => r.dealId))];
  const [orgRows, dealRows] = await Promise.all([
    orgIds.length ? db.select({ id: organizations.id, legalName: organizations.legalName }).from(organizations).where(inArray(organizations.id, orgIds)) : Promise.resolve([]),
    dealIds.length ? db.select({ id: deals.id, reference: deals.reference }).from(deals).where(inArray(deals.id, dealIds)) : Promise.resolve([]),
  ]);
  const orgNameById = new Map(orgRows.map((o) => [o.id, o.legalName]));
  const dealRefById = new Map(dealRows.map((d) => [d.id, d.reference]));
  const partnerOrgById = new Map(partners.map((p) => [p.id, p.organizationId]));
  const enrichedRecords = records.map((r) => ({
    ...r,
    dealReference: dealRefById.get(r.dealId) || `#${r.dealId}`,
    referralPartnerOrgName: orgNameById.get(partnerOrgById.get(r.referralPartnerId) || -1) || "Unknown",
  }));
  const enrichedPartners = partners.map((p) => ({ ...p, organizationName: orgNameById.get(p.organizationId) || "Unknown" }));
  return Response.json({ commissionRecords: enrichedRecords, referralPartners: enrichedPartners, referralAttributions: attributions });
}

export async function POST(request: Request) {
  const auth = await requirePlatformRoleOrResponse(request, [...REVIEWER_ROLES]);
  if (auth instanceof Response) return auth;
  const admin = auth;

  let body: {
    dealId?: number; referralPartnerId?: number; attributionId?: number | null;
    basis?: string; rate?: number; flatAmount?: number; currency?: string; payerParty?: string; notes?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const dealId = Number(body.dealId);
  const referralPartnerId = Number(body.referralPartnerId);
  const basis = String(body.basis || "");
  const payerParty = String(body.payerParty || "").trim();
  if (!dealId || !referralPartnerId) return Response.json({ error: "dealId and referralPartnerId are required." }, { status: 400 });
  if (!(COMMISSION_BASES as readonly string[]).includes(basis)) return Response.json({ error: `basis must be one of: ${COMMISSION_BASES.join(", ")}` }, { status: 400 });
  if (!payerParty) return Response.json({ error: "payerParty is required — commissions must always disclose who pays them." }, { status: 400 });
  if (basis === "percentage" && !(Number(body.rate) > 0)) return Response.json({ error: "A positive rate is required for a percentage-basis commission." }, { status: 400 });
  if (basis === "flat" && !(Number(body.flatAmount) > 0)) return Response.json({ error: "A positive flatAmount is required for a flat-basis commission." }, { status: 400 });

  const db = getDb();
  const [deal] = await db.select({ id: deals.id }).from(deals).where(eq(deals.id, dealId)).limit(1);
  if (!deal) return Response.json({ error: "Deal not found." }, { status: 404 });
  const [partner] = await db.select({ id: referralPartners.id }).from(referralPartners).where(eq(referralPartners.id, referralPartnerId)).limit(1);
  if (!partner) return Response.json({ error: "Referral partner not found." }, { status: 404 });

  const [record] = await db
    .insert(commissionRecords)
    .values({
      dealId,
      referralPartnerId,
      attributionId: body.attributionId ?? null,
      basis,
      rate: basis === "percentage" ? Number(body.rate) : null,
      flatAmount: basis === "flat" ? Number(body.flatAmount) : null,
      currency: String(body.currency || "USD"),
      payerParty,
      notes: String(body.notes || "").trim(),
      createdByEmail: admin.email,
    })
    .returning();

  await db.insert(adminAuditEvents).values({
    actorUserId: admin.id, action: "commission_recorded", entityType: "commission_record", entityId: record.id,
    fromStatus: "", toStatus: "pending", reason: `Recorded for deal #${dealId} — ${basis === "percentage" ? `${body.rate}%` : `${body.flatAmount} ${record.currency}`}, payer: ${payerParty}`,
  });
  return Response.json({ commissionRecord: record }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requirePlatformRoleOrResponse(request, [...REVIEWER_ROLES]);
  if (auth instanceof Response) return auth;
  const admin = auth;

  let body: { id?: number; status?: string; reason?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const id = Number(body.id);
  const status = String(body.status || "");
  const reason = String(body.reason || "").trim();
  if (!id) return Response.json({ error: "Not found." }, { status: 404 });
  if (!reason) return Response.json({ error: "A reason is required for this decision." }, { status: 400 });
  // Whitelist check against the real enum — "paid" is not, and never will
  // be, a member of it (see db/schema.ts's COMMISSION_STATUSES).
  if (!(COMMISSION_STATUSES as readonly string[]).includes(status)) {
    return Response.json({ error: `status must be one of: ${COMMISSION_STATUSES.join(", ")}` }, { status: 400 });
  }

  const db = getDb();
  const [record] = await db.select().from(commissionRecords).where(eq(commissionRecords.id, id)).limit(1);
  if (!record) return Response.json({ error: "Not found." }, { status: 404 });

  const now = new Date().toISOString();
  await db
    .update(commissionRecords)
    .set({
      status,
      updatedAt: now,
      ...(status === "approved" ? { approvedByEmail: admin.email, approvedAt: now } : {}),
    })
    .where(eq(commissionRecords.id, id));
  await db.insert(adminAuditEvents).values({
    actorUserId: admin.id, action: "commission_status_change", entityType: "commission_record", entityId: id,
    fromStatus: record.status, toStatus: status, reason,
  });
  return Response.json({ ok: true });
}
