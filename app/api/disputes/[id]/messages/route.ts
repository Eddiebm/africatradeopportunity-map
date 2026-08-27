import { asc, eq } from "drizzle-orm";
import { requireUserOrResponse } from "../../../../../lib/auth/current-user";
import { getDb } from "../../../../../db";
import { dealEvents, disputeMessages, disputes } from "../../../../../db/schema";
import type { SessionUser } from "../../../../../lib/auth/session";

const REVIEWER_ROLES = ["administrator", "verification_analyst"] as const;

async function loadDisputeAccess(disputeId: number, user: SessionUser) {
  const db = getDb();
  const [dispute] = await db.select().from(disputes).where(eq(disputes.id, disputeId)).limit(1);
  if (!dispute) return { dispute: null, isOwner: false, isReviewer: false };
  const isOwner = dispute.openedByEmail === user.email;
  const isReviewer = Boolean(user.platformRole && REVIEWER_ROLES.includes(user.platformRole));
  return { dispute, isOwner, isReviewer };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUserOrResponse(request);
  if (auth instanceof Response) return auth;
  const user = auth;
  const disputeId = Number((await params).id);
  if (!disputeId) return Response.json({ error: "Dispute not found." }, { status: 404 });

  const { dispute, isOwner, isReviewer } = await loadDisputeAccess(disputeId, user);
  if (!dispute || (!isOwner && !isReviewer)) return Response.json({ error: "Dispute not found." }, { status: 404 });

  const rows = await getDb().select().from(disputeMessages).where(eq(disputeMessages.disputeId, disputeId)).orderBy(asc(disputeMessages.id));
  const visible = isReviewer ? rows : rows.filter((m) => m.audience === "parties");
  return Response.json({ messages: visible });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUserOrResponse(request);
  if (auth instanceof Response) return auth;
  const user = auth;
  const disputeId = Number((await params).id);
  if (!disputeId) return Response.json({ error: "Dispute not found." }, { status: 404 });

  const { dispute, isOwner, isReviewer } = await loadDisputeAccess(disputeId, user);
  if (!dispute || (!isOwner && !isReviewer)) return Response.json({ error: "Dispute not found." }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const messageBody = String(body.body ?? "").trim();
  if (!messageBody) return Response.json({ error: "Enter a message." }, { status: 400 });

  // Only a reviewer may ever request the internal audience; the dispute
  // opener is rejected outright rather than silently downgraded, so a
  // client bug can't make them believe an internal note went to staff only.
  const requestedAudience = typeof body.audience === "string" ? body.audience : undefined;
  if (!isReviewer && requestedAudience === "internal") {
    return Response.json({ error: "You cannot post an internal-only message." }, { status: 403 });
  }
  const audience: "parties" | "internal" = isReviewer && requestedAudience === "internal" ? "internal" : "parties";

  const db = getDb();
  const [message] = await db.insert(disputeMessages).values({ disputeId, authorEmail: user.email, audience, body: messageBody }).returning();

  // Mirror onto the deal's activity timeline, matching how POST
  // /api/disputes already logs "dispute_opened" there — but only for the
  // parties audience: an internal note must never leak into the deal
  // owner's own activity feed on app/deal/[id]/page.tsx.
  if (audience === "parties") {
    await db.insert(dealEvents).values({ dealId: dispute.dealId, actorEmail: user.email, eventType: "dispute_message", summary: `New message on ${dispute.reference}` });
  }

  return Response.json({ message }, { status: 201 });
}
