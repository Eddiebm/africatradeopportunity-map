// docs/AUDIT.md Priority 1: "Deal-party assignment and removal" — protect
// against "Users assigning themselves to deals" and "Unauthorized role
// changes." Every mutation here is owner-only (see
// lib/auth/deal-access.ts's canManageDeal) — a non-owner, including one
// who already has view access as a counterparty, cannot assign or remove
// parties, and can never grant that access to themselves.
import { and, eq, isNull } from "drizzle-orm";
import { requireDealAccessOrResponse, canManageDeal } from "../../../../../lib/auth/deal-access";
import { getDb } from "../../../../../db";
import { dealEvents, dealParties, organizations, ORGANIZATION_ROLES } from "../../../../../db/schema";

const FORBIDDEN = (message = "Only the deal owner can manage deal parties.") => Response.json({ error: message }, { status: 403 });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const dealId = Number((await params).id);
  const guard = await requireDealAccessOrResponse(request, dealId);
  if (guard instanceof Response) return guard;

  const db = getDb();
  const parties = await db.select().from(dealParties).where(and(eq(dealParties.dealId, dealId), isNull(dealParties.removedAt)));
  return Response.json({ parties });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const dealId = Number((await params).id);
  const guard = await requireDealAccessOrResponse(request, dealId);
  if (guard instanceof Response) return guard;
  const { user, access } = guard;
  if (!canManageDeal(access)) return FORBIDDEN();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const role = String(body.role ?? "");
  if (!(ORGANIZATION_ROLES as readonly string[]).includes(role)) {
    return Response.json({ error: `role must be one of: ${ORGANIZATION_ROLES.join(", ")}` }, { status: 400 });
  }
  const organizationId = body.organizationId != null ? Number(body.organizationId) : null;
  const contact = typeof body.contact === "string" ? body.contact.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!organizationId && !contact) {
    return Response.json({ error: "Provide an organizationId or a contact for this party." }, { status: 400 });
  }

  const db = getDb();
  // Never trust a client-supplied organizationId without confirming it's a
  // real row — an IDOR-style attempt to reference an org that doesn't
  // exist would otherwise silently insert a dangling reference.
  if (organizationId) {
    const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    if (!org) return Response.json({ error: "That organization does not exist." }, { status: 400 });
  }

  const [party] = await db
    .insert(dealParties)
    .values({ dealId, organizationId, role, name, contact, assignedByEmail: user.email })
    .returning();
  await db.insert(dealEvents).values({
    dealId,
    actorEmail: user.email,
    eventType: "party_assigned",
    summary: `${role.replaceAll("_", " ")} added${name ? `: ${name}` : ""}`,
  });
  return Response.json({ party }, { status: 201 });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const dealId = Number((await params).id);
  const guard = await requireDealAccessOrResponse(request, dealId);
  if (guard instanceof Response) return guard;
  const { user, access } = guard;
  if (!canManageDeal(access)) return FORBIDDEN();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const partyId = Number(body.partyId);
  if (!partyId) return Response.json({ error: "partyId is required." }, { status: 400 });

  const db = getDb();
  // Scoped to this dealId, not just this partyId — an owner of deal A
  // cannot use this to remove a party row that actually belongs to deal B
  // by guessing its id (IDOR).
  const [party] = await db.select().from(dealParties).where(and(eq(dealParties.id, partyId), eq(dealParties.dealId, dealId), isNull(dealParties.removedAt))).limit(1);
  if (!party) return Response.json({ error: "Party not found on this deal." }, { status: 404 });

  await db.update(dealParties).set({ removedAt: new Date().toISOString(), removedByEmail: user.email }).where(eq(dealParties.id, partyId));
  await db.insert(dealEvents).values({
    dealId,
    actorEmail: user.email,
    eventType: "party_removed",
    summary: `${party.role.replaceAll("_", " ")} removed${party.name ? `: ${party.name}` : ""}`,
  });
  return Response.json({ ok: true });
}
