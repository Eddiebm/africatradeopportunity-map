import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { dealEvents, deals, milestones } from "../../../../../../db/schema";
import { requireUserOrResponse } from "../../../../../../lib/auth/current-user";

// The deal owner can only self-report that evidence exists — they cannot
// mark their own milestone verified (that's an admin action, see
// app/api/admin/desk/route.ts's "milestone" entity type). And this never
// releases money: milestones.status stays "proposed" until an
// administrator reviews the evidence; even then, only a licensed payment
// partner executes an actual release. See app/deal/[id]/page.tsx's
// "Licensed partner execution required" note.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; milestoneId: string }> }) {
  const auth = await requireUserOrResponse(request);
  if (auth instanceof Response) return auth;
  const user = auth;
  const { id, milestoneId } = await params;
  const dealId = Number(id);
  const msId = Number(milestoneId);
  if (!dealId || !msId) return Response.json({ error: "Not found." }, { status: 404 });

  const db = getDb();
  const [deal] = await db.select().from(deals).where(and(eq(deals.id, dealId), eq(deals.ownerEmail, user.email))).limit(1);
  if (!deal) return Response.json({ error: "Deal not found." }, { status: 404 });

  const [milestone] = await db.select().from(milestones).where(and(eq(milestones.id, msId), eq(milestones.dealId, dealId))).limit(1);
  if (!milestone) return Response.json({ error: "Milestone not found." }, { status: 404 });
  if (milestone.evidenceStatus === "verified") {
    return Response.json({ error: "This milestone has already been verified — evidence can't be resubmitted." }, { status: 409 });
  }

  await db.update(milestones).set({ evidenceStatus: "submitted" }).where(eq(milestones.id, msId));
  await db.insert(dealEvents).values({
    dealId,
    actorEmail: user.email,
    eventType: "milestone_evidence_submitted",
    summary: `Evidence submitted for milestone "${milestone.name}" — awaiting administrator review`,
  });

  return Response.json({ ok: true });
}
