import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { organizationMembers, organizations } from "../../../../../../db/schema";
import { requireUserOrResponse } from "../../../../../../lib/auth/current-user";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  const auth = await requireUserOrResponse(request);
  if (auth instanceof Response) return auth;
  const user = auth;
  const { id, memberId } = await params;
  const organizationId = Number(id);
  const membershipId = Number(memberId);
  if (!organizationId || !membershipId) return Response.json({ error: "Not found." }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const action = String(body.action ?? "");
  if (!["accept", "decline", "remove"].includes(action)) {
    return Response.json({ error: "Unknown action." }, { status: 400 });
  }

  const db = getDb();
  const [membership] = await db
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.id, membershipId), eq(organizationMembers.organizationId, organizationId)))
    .limit(1);
  if (!membership) return Response.json({ error: "Membership not found." }, { status: 404 });

  const now = new Date().toISOString();

  if (action === "accept" || action === "decline") {
    // Only the invited person can respond to their own invitation.
    if (membership.userId !== user.id || membership.status !== "invited") {
      return Response.json({ error: "This invitation is not available to you." }, { status: 403 });
    }
    const [updated] = await db
      .update(organizationMembers)
      .set(action === "accept" ? { status: "active", joinedAt: now } : { status: "removed", removedAt: now })
      .where(eq(organizationMembers.id, membershipId))
      .returning();
    return Response.json({ membership: updated });
  }

  // action === "remove": only the organization's creator can remove a
  // member (including revoking a still-pending invitation).
  const [organization] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!organization || organization.ownerEmail !== user.email) {
    return Response.json({ error: "Only the organization's creator can remove members." }, { status: 403 });
  }
  const [updated] = await db
    .update(organizationMembers)
    .set({ status: "removed", removedAt: now })
    .where(eq(organizationMembers.id, membershipId))
    .returning();
  return Response.json({ membership: updated });
}
