import { and, eq, like, or } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { deals, organizationMembers, organizations, quoteRequests } from "../../../../../db/schema";
import { requireUserOrResponse } from "../../../../../lib/auth/current-user";

const QUOTE_TYPES = ["buy", "sell", "freight"] as const;

async function isDealOwner(dealId: number, email: string) {
  const db = getDb();
  const [deal] = await db.select().from(deals).where(and(eq(deals.id, dealId), eq(deals.ownerEmail, email))).limit(1);
  return deal ?? null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUserOrResponse(request);
  if (auth instanceof Response) return auth;
  const user = auth;
  const dealId = Number((await params).id);
  if (!dealId) return Response.json({ error: "Deal not found." }, { status: 404 });

  const db = getDb();
  const deal = await isDealOwner(dealId, user.email);
  // A quote request is also visible to any active member of the
  // organization it was sent to, so they can find and respond to it —
  // even though they don't own the deal itself.
  const myOrgs = await db.select({ organizationId: organizationMembers.organizationId }).from(organizationMembers).where(and(eq(organizationMembers.userId, user.id), eq(organizationMembers.status, "active")));
  const myOrgIds = myOrgs.map((m) => m.organizationId);

  if (!deal && !myOrgIds.length) return Response.json({ error: "Deal not found." }, { status: 404 });

  const rows = await db.select().from(quoteRequests).where(eq(quoteRequests.dealId, dealId));
  const visible = rows.filter((r) => deal || myOrgIds.includes(r.recipientOrganizationId));
  return Response.json({ quoteRequests: visible });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUserOrResponse(request);
  if (auth instanceof Response) return auth;
  const user = auth;
  const dealId = Number((await params).id);
  if (!dealId) return Response.json({ error: "Deal not found." }, { status: 404 });

  const deal = await isDealOwner(dealId, user.email);
  if (!deal) return Response.json({ error: "Deal not found." }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const requesterOrganizationId = Number(body.requesterOrganizationId);
  const recipientOrganizationName = String(body.recipientOrganizationName ?? "").trim();
  const quoteType = String(body.quoteType ?? "") as (typeof QUOTE_TYPES)[number];
  const dueAt = typeof body.dueAt === "string" && body.dueAt ? body.dueAt : null;
  const requirements = typeof body.requirements === "string" ? body.requirements.slice(0, 2000) : "";

  if (!requesterOrganizationId) return Response.json({ error: "Choose which organization you're requesting on behalf of." }, { status: 400 });
  if (!recipientOrganizationName) return Response.json({ error: "Enter the counterparty organization's name." }, { status: 400 });
  if (!QUOTE_TYPES.includes(quoteType)) return Response.json({ error: "Choose what kind of quote you need." }, { status: 400 });

  const db = getDb();
  const [membership] = await db.select().from(organizationMembers).where(and(eq(organizationMembers.organizationId, requesterOrganizationId), eq(organizationMembers.userId, user.id), eq(organizationMembers.status, "active"))).limit(1);
  if (!membership) return Response.json({ error: "You are not an active member of that organization." }, { status: 403 });

  // Quotes can only be requested from a verified organization — this is a
  // real trust boundary (docs/AUDIT.md's whole point about not fabricating
  // verification), not a UX nicety.
  const matches = await db.select().from(organizations).where(and(eq(organizations.verificationStatus, "verified"), or(eq(organizations.legalName, recipientOrganizationName), like(organizations.legalName, `%${recipientOrganizationName}%`))));
  if (matches.length === 0) return Response.json({ error: "No verified organization matches that name." }, { status: 404 });
  if (matches.length > 1) return Response.json({ error: `${matches.length} verified organizations match — be more specific (try the exact legal name).` }, { status: 409 });
  const recipient = matches[0];
  if (recipient.id === requesterOrganizationId) return Response.json({ error: "You can't request a quote from your own organization." }, { status: 400 });

  const id = `QR-${dealId}-${Date.now().toString(36).toUpperCase()}`;
  const [request_] = await db.insert(quoteRequests).values({
    id,
    dealId,
    requesterOrganizationId,
    recipientOrganizationId: recipient.id,
    quoteType,
    requirements,
    dueAt,
  }).returning();

  return Response.json({ quoteRequest: request_, recipient: { id: recipient.id, legalName: recipient.legalName } }, { status: 201 });
}
