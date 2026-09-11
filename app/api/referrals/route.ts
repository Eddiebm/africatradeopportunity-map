import { and, eq } from "drizzle-orm";
import { requireUserOrResponse } from "../../../lib/auth/current-user";
import { createReferralCode, listReferralCodesForOrganization } from "../../../lib/referrals";
import { getDb } from "../../../db";
import { organizationMembers, referralAttributions } from "../../../db/schema";

// Priority 11 (docs/production-readiness.md): "partner-specific intake
// links" + post-deal "refer buyer/supplier." Any real, active member of
// an organization can generate a referral code for it — not role-gated
// (see lib/referrals.ts's header), because both a broker and an ordinary
// trader referring a past counterparty are legitimate uses of the same
// mechanism.
export async function POST(request: Request) {
  const auth = await requireUserOrResponse(request);
  if (auth instanceof Response) return auth;
  const user = auth;

  let body: { organizationId?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const organizationId = Number(body.organizationId);
  if (!organizationId) return Response.json({ error: "organizationId is required." }, { status: 400 });

  const db = getDb();
  // Never trust a client-supplied organizationId — a real, active
  // membership is required, same discipline as every other org-scoped
  // write in this app (see e.g. app/api/deals/[id]/parties/route.ts).
  const [membership] = await db
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, user.id), eq(organizationMembers.status, "active")))
    .limit(1);
  if (!membership) return Response.json({ error: "You are not an active member of this organization." }, { status: 403 });

  const partner = await createReferralCode(organizationId, user.email);
  return Response.json({ referralPartner: partner }, { status: 201 });
}

export async function GET(request: Request) {
  const auth = await requireUserOrResponse(request);
  if (auth instanceof Response) return auth;
  const user = auth;
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!organizationId) return Response.json({ error: "organizationId is required." }, { status: 400 });

  const db = getDb();
  const [membership] = await db
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, user.id), eq(organizationMembers.status, "active")))
    .limit(1);
  if (!membership) return Response.json({ error: "You are not an active member of this organization." }, { status: 403 });

  const codes = await listReferralCodesForOrganization(organizationId);
  // Own-performance visibility only — how many referees each of THEIR
  // codes attributed, never the referees' identities/contact details
  // (that would defeat the referred party's own privacy for no reason
  // this org needs).
  const counts = await Promise.all(
    codes.map(async (c) => {
      const rows = await db.select({ id: referralAttributions.id }).from(referralAttributions).where(and(eq(referralAttributions.referralPartnerId, c.id), eq(referralAttributions.isPrimary, true)));
      return { ...c, attributionCount: rows.length };
    }),
  );
  return Response.json({ referralPartners: counts });
}
