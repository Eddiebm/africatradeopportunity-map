import { asc, eq } from "drizzle-orm";
import { requireUserOrResponse } from "../../../../lib/auth/current-user";
import { canParticipateInDispute, resolveDealViewAccess } from "../../../../lib/auth/deal-access";
import { getDb } from "../../../../db";
import { disputeEvents, disputeMessages, disputes } from "../../../../db/schema";

const REVIEWER_ROLES = ["administrator", "verification_analyst"] as const;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUserOrResponse(request);
  if (auth instanceof Response) return auth;
  const user = auth;
  const disputeId = Number((await params).id);
  if (!disputeId) return Response.json({ error: "Dispute not found." }, { status: 404 });

  const db = getDb();
  const [dispute] = await db.select().from(disputes).where(eq(disputes.id, disputeId)).limit(1);
  if (!dispute) return Response.json({ error: "Dispute not found." }, { status: 404 });

  // docs/AUDIT.md Priority 1: a legitimate counterparty on the underlying
  // deal (not just whoever opened the case) can now see and participate —
  // see lib/auth/deal-access.ts's canParticipateInDispute.
  const isReviewer = Boolean(user.platformRole && REVIEWER_ROLES.includes(user.platformRole));
  const dealAccess = await resolveDealViewAccess(dispute.dealId, user);
  // Same not-found-not-forbidden convention as app/api/deals/[id]/quote-requests/route.ts —
  // a caller with no legitimate reason to know this dispute exists gets 404, not 403.
  if (!canParticipateInDispute(dispute, dealAccess, user)) return Response.json({ error: "Dispute not found." }, { status: 404 });

  const [messages, events] = await Promise.all([
    db.select().from(disputeMessages).where(eq(disputeMessages.disputeId, disputeId)).orderBy(asc(disputeMessages.id)),
    db.select().from(disputeEvents).where(eq(disputeEvents.disputeId, disputeId)).orderBy(asc(disputeEvents.id)),
  ]);

  // Internal-audience messages are for reviewers only — never shown to the
  // party who opened the case, even though they own the dispute row itself.
  const visibleMessages = isReviewer ? messages : messages.filter((m) => m.audience === "parties");

  return Response.json({ dispute, messages: visibleMessages, events });
}
