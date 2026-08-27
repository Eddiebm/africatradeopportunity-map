import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { organizationMembers, organizations, quoteRequests, users } from "../../../../db/schema";
import { requireUserOrResponse } from "../../../../lib/auth/current-user";

async function membershipFor(organizationId: number, userId: number) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId), eq(organizationMembers.status, "active")))
    .limit(1);
  return row;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUserOrResponse(request);
  if (auth instanceof Response) return auth;
  const user = auth;
  const organizationId = Number((await params).id);
  if (!organizationId) return Response.json({ error: "Organization not found." }, { status: 404 });

  const db = getDb();
  const [organization] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!organization) return Response.json({ error: "Organization not found." }, { status: 404 });

  const membership = await membershipFor(organizationId, user.id);
  if (!membership) return Response.json({ error: "You are not a member of this organization." }, { status: 403 });

  const members = await db
    .select({ member: organizationMembers, email: users.email, displayName: users.displayName })
    .from(organizationMembers)
    .innerJoin(users, eq(organizationMembers.userId, users.id))
    .where(eq(organizationMembers.organizationId, organizationId));

  // Any active member can see (and, elsewhere, respond to) quote requests
  // sent to this organization — submitting a quote only requires active
  // membership, not ownership, so this list needs to match that.
  const incomingQuoteRequests = await db
    .select()
    .from(quoteRequests)
    .where(eq(quoteRequests.recipientOrganizationId, organizationId))
    .orderBy(desc(quoteRequests.createdAt))
    .limit(100);

  return Response.json({
    organization: { ...organization, myRole: membership.role, isOwner: organization.ownerEmail === user.email },
    members: members.map((m) => ({
      id: m.member.id,
      email: m.email,
      displayName: m.displayName,
      role: m.member.role,
      status: m.member.status,
      invitedEmail: m.member.invitedEmail,
      joinedAt: m.member.joinedAt,
    })),
    incomingQuoteRequests,
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUserOrResponse(request);
  if (auth instanceof Response) return auth;
  const user = auth;
  const organizationId = Number((await params).id);
  if (!organizationId) return Response.json({ error: "Organization not found." }, { status: 404 });

  const db = getDb();
  const [organization] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!organization) return Response.json({ error: "Organization not found." }, { status: 404 });
  // Profile edits are restricted to the organization's creator. There is no
  // separate "org admin" business role in ORGANIZATION_ROLES (trader,
  // buyer, supplier, freight_provider, inspector, broker,
  // partner_institution are all participant roles, not administrative
  // ones) — extending edit rights to other members is a documented Phase 2
  // limitation, not an oversight.
  if (organization.ownerEmail !== user.email) {
    return Response.json({ error: "Only the organization's creator can edit its profile." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const updates: Partial<typeof organizations.$inferInsert> = {};
  if (typeof body.legalName === "string" && body.legalName.trim()) updates.legalName = body.legalName.trim().slice(0, 200);
  if (typeof body.tradingName === "string") updates.tradingName = body.tradingName.trim().slice(0, 200);
  if (typeof body.country === "string" && body.country.trim()) updates.country = body.country.trim().slice(0, 120);
  if (typeof body.registrationNumber === "string") updates.registrationNumber = body.registrationNumber.trim().slice(0, 100);
  if (typeof body.phone === "string") updates.phone = body.phone.trim().slice(0, 40);
  if (!Object.keys(updates).length) return Response.json({ error: "Nothing to update." }, { status: 400 });

  const [updated] = await db.update(organizations).set(updates).where(eq(organizations.id, organizationId)).returning();
  return Response.json({ organization: updated });
}
