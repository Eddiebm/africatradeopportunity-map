import { eq } from "drizzle-orm";
import { requirePlatformRoleOrResponse } from "../../../../../../lib/auth/current-user";
import { getDb } from "../../../../../../db";
import { adminAuditEvents, dealEvents, milestones } from "../../../../../../db/schema";

const REVIEWER_ROLES = ["administrator", "verification_analyst"] as const;

// Priority 8 (docs/production-readiness.md): the only way milestones.dueAt
// (see db/schema.ts's comment on that column) ever gets set for milestones
// 1-3, or changed for milestone 4 after the deal-creation default (see
// app/api/deals/route.ts). Deliberately a small, separate route rather than
// folded into app/api/admin/desk/route.ts's "milestone" entity, which only
// ever mutates evidenceStatus — scheduling a deadline is a different kind
// of decision (when should this happen) from reviewing evidence (did this
// happen), and mixing them would make both routes' request/response shapes
// murkier for no real benefit.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformRoleOrResponse(request, [...REVIEWER_ROLES]);
  if (auth instanceof Response) return auth;
  const admin = auth;
  const { id } = await params;
  const milestoneId = Number(id);
  if (!milestoneId) return Response.json({ error: "Not found." }, { status: 404 });

  let body: { dueAt?: string | null; reason?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const reason = String(body.reason || "").trim();
  if (!reason) return Response.json({ error: "A reason is required for this decision." }, { status: 400 });

  let dueAt: string | null = null;
  if (body.dueAt) {
    const parsed = Date.parse(String(body.dueAt));
    if (Number.isNaN(parsed)) return Response.json({ error: "Invalid due date." }, { status: 400 });
    dueAt = new Date(parsed).toISOString();
  }

  const db = getDb();
  const [milestone] = await db.select().from(milestones).where(eq(milestones.id, milestoneId)).limit(1);
  if (!milestone) return Response.json({ error: "Not found." }, { status: 404 });

  await db.update(milestones).set({ dueAt }).where(eq(milestones.id, milestoneId));
  await db.insert(dealEvents).values({
    dealId: milestone.dealId,
    actorEmail: admin.email,
    eventType: "milestone_scheduled",
    summary: dueAt
      ? `Due date set for milestone "${milestone.name}": ${dueAt}. ${reason}`
      : `Due date cleared for milestone "${milestone.name}". ${reason}`,
  });
  await db.insert(adminAuditEvents).values({
    actorUserId: admin.id,
    action: "milestone_scheduled",
    entityType: "milestone",
    entityId: milestoneId,
    fromStatus: milestone.dueAt || "",
    toStatus: dueAt || "",
    reason,
  });

  return Response.json({ ok: true });
}
