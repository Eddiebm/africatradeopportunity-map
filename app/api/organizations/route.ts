import { and, eq, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { ORGANIZATION_ROLES, organizationMembers, organizations, type OrganizationRole } from "../../../db/schema";
import { requireUserOrResponse } from "../../../lib/auth/current-user";

const COUNTRY_MAX = 120;

export async function GET(request: Request) {
  const auth = await requireUserOrResponse(request);
  if (auth instanceof Response) return auth;
  const user = auth;
  const db = getDb();

  const memberships = await db
    .select({ membership: organizationMembers, organization: organizations })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
    .where(and(eq(organizationMembers.userId, user.id), eq(organizationMembers.status, "active")));

  const invitations = await db
    .select({ membership: organizationMembers, organization: organizations })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
    .where(
      and(
        eq(organizationMembers.status, "invited"),
        or(eq(organizationMembers.userId, user.id), eq(organizationMembers.invitedEmail, user.email)),
      ),
    );

  return Response.json({
    mine: memberships.map((m) => ({ ...m.organization, myRole: m.membership.role, membershipId: m.membership.id })),
    invitations: invitations.map((m) => ({
      membershipId: m.membership.id,
      organizationId: m.organization.id,
      organizationName: m.organization.legalName,
      role: m.membership.role,
      invitedAt: m.membership.invitedAt,
    })),
  });
}

export async function POST(request: Request) {
  const auth = await requireUserOrResponse(request);
  if (auth instanceof Response) return auth;
  const user = auth;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const legalName = String(body.legalName ?? "").trim();
  const tradingName = String(body.tradingName ?? "").trim();
  const country = String(body.country ?? "").trim();
  const registrationNumber = String(body.registrationNumber ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const role = String(body.role ?? "") as OrganizationRole;

  if (!legalName || legalName.length > 200) {
    return Response.json({ error: "Enter the organization's legal name (up to 200 characters)." }, { status: 400 });
  }
  if (!country || country.length > COUNTRY_MAX) {
    return Response.json({ error: "Enter the organization's country." }, { status: 400 });
  }
  if (!ORGANIZATION_ROLES.includes(role)) {
    return Response.json({ error: "Choose your role within this organization." }, { status: 400 });
  }

  const db = getDb();
  const now = new Date().toISOString();
  const [organization] = await db
    .insert(organizations)
    .values({ ownerEmail: user.email, legalName, tradingName, country, registrationNumber, phone })
    .returning();

  await db.insert(organizationMembers).values({
    organizationId: organization.id,
    userId: user.id,
    role,
    status: "active",
    joinedAt: now,
  });

  return Response.json({ organization: { ...organization, myRole: role } }, { status: 201 });
}
