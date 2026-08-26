import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { ORGANIZATION_ROLES, organizationMembers, organizations, users, type OrganizationRole } from "../../../../../db/schema";
import { requireUserOrResponse } from "../../../../../lib/auth/current-user";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUserOrResponse(request);
  if (auth instanceof Response) return auth;
  const user = auth;
  const organizationId = Number((await params).id);
  if (!organizationId) return Response.json({ error: "Organization not found." }, { status: 404 });

  const db = getDb();
  const [organization] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!organization) return Response.json({ error: "Organization not found." }, { status: 404 });
  if (organization.ownerEmail !== user.email) {
    return Response.json({ error: "Only the organization's creator can invite members." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  const role = String(body.role ?? "") as OrganizationRole;
  if (!email) return Response.json({ error: "Enter the email address to invite." }, { status: 400 });
  if (!ORGANIZATION_ROLES.includes(role)) return Response.json({ error: "Choose a role for this invitation." }, { status: 400 });

  const [invitee] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!invitee) {
    // Deliberately not a silent pending-invite-by-email flow: this schema's
    // organization_members.user_id is NOT NULL by design (every membership
    // row, invited or active, points at a real account). Inviting someone
    // who hasn't registered yet is a real Phase 2 limitation, not an
    // oversight — see docs/AUDIT.md.
    return Response.json(
      { error: "That email hasn't registered a TradeSafe Africa account yet. Ask them to sign up, then invite them." },
      { status: 400 },
    );
  }

  const [existing] = await db
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, invitee.id)))
    .limit(1);
  if (existing && existing.status !== "removed") {
    return Response.json({ error: "This person already has a membership or pending invitation." }, { status: 409 });
  }

  const now = new Date().toISOString();
  const [membership] = await db
    .insert(organizationMembers)
    .values({
      organizationId,
      userId: invitee.id,
      role,
      status: "invited",
      invitedByUserId: user.id,
      invitedEmail: email,
      invitedAt: now,
    })
    .returning();

  return Response.json({ invitation: membership }, { status: 201 });
}
