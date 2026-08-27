// docs/AUDIT.md §5 item 5: "Document download is owner-only, not
// participant-aware. ... dealParties exists in the schema for
// counterparties but is never consulted — a legitimate counterparty or
// assigned verification analyst has no path to view deal documents."
//
// This resolves who may VIEW a deal (the deal room, its documents,
// disputes tied to it) — not who may ACT within it. Submitting evidence,
// uploading documents, accepting/declining quotes, and reporting milestone
// evidence stay owner-only actions everywhere else in the app; extending
// write access to counterparties is a separate product decision this
// audit item didn't ask for. This module only ever widens *read* access
// plus dispute *participation*, and only along DB-backed relationships —
// nothing here trusts a client-supplied dealId, email, or role (see
// lib/auth/current-user.ts's contract).
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "../../db";
import { deals, dealParties, organizationMembers } from "../../db/schema";
import type { SessionUser } from "./current-user";
import { requireUserOrResponse } from "./current-user";

export type DealViewReason = "owner" | "platform_role" | "organization_party" | "contact_match";

export type DealViewAccess = {
  deal: typeof deals.$inferSelect;
  reason: DealViewReason;
};

/**
 * Returns the deal + why access was granted if `user` may view it, or null
 * if the deal doesn't exist or `user` has no recognized relationship to it.
 * Checked in this order:
 *   1. Deal owner (the existing, always-correct check).
 *   2. Platform role: administrator or verification_analyst — the same
 *      roles that already have full override access via the admin desk
 *      (app/api/admin/desk/route.ts); withholding read access here while
 *      granting them mutation access there would be inconsistent, not
 *      more secure.
 *   3. A NON-REMOVED deal_parties row for this deal whose organizationId
 *      matches one of the user's *active* organization memberships. A
 *      removed party (removedAt set — see
 *      app/api/deals/[id]/parties/route.ts DELETE) or an inactive/removed
 *      membership grants nothing — access follows the current
 *      relationship, not a historical one.
 *   4. A non-removed deal_parties row whose freeform `contact` field
 *      case-insensitively matches the user's account email — the fallback
 *      for a party recorded before they had an account, or one never
 *      linked to an organization at all.
 */
export async function resolveDealViewAccess(dealId: number, user: SessionUser): Promise<DealViewAccess | null> {
  const db = getDb();
  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId)).limit(1);
  if (!deal) return null;

  if (deal.ownerEmail === user.email) return { deal, reason: "owner" };

  if (user.platformRole === "administrator" || user.platformRole === "verification_analyst") {
    return { deal, reason: "platform_role" };
  }

  const parties = await db.select().from(dealParties).where(and(eq(dealParties.dealId, dealId), isNull(dealParties.removedAt)));
  if (parties.length === 0) return null;

  const orgIds = parties.map((p) => p.organizationId).filter((orgId): orgId is number => orgId != null);
  if (orgIds.length > 0) {
    const [membership] = await db
      .select({ organizationId: organizationMembers.organizationId })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.userId, user.id),
          eq(organizationMembers.status, "active"),
          inArray(organizationMembers.organizationId, orgIds),
        ),
      )
      .limit(1);
    if (membership) return { deal, reason: "organization_party" };
  }

  const emailLower = user.email.trim().toLowerCase();
  if (parties.some((p) => p.contact.trim().toLowerCase() === emailLower)) {
    return { deal, reason: "contact_match" };
  }

  return null;
}

/** True only for the deal owner — every mutating deal-room action (upload,
 * evidence, quote decisions, party assignment/removal) stays gated on
 * this, deliberately narrower than view access. See this file's header. */
export function canManageDeal(access: DealViewAccess): boolean {
  return access.reason === "owner";
}

/**
 * A dispute is visible/participable to whoever opened it, plus anyone who
 * can view the deal it's about (owner, platform staff, or a recognized
 * counterparty — see resolveDealViewAccess). `dealAccess` should be the
 * result of calling resolveDealViewAccess(dispute.dealId, user) — passed
 * in rather than recomputed here so call sites that already have it (most
 * do, since they also need the deal for other reasons) don't double-query.
 * This does not decide *audience* (parties vs. internal-only) — see
 * app/api/disputes/[id]/messages/route.ts's separate reviewer check for
 * that; a counterparty granted access here still only ever sees
 * audience:"parties" messages.
 */
export function canParticipateInDispute(
  dispute: { openedByEmail: string },
  dealAccess: DealViewAccess | null,
  user: SessionUser,
): boolean {
  return dispute.openedByEmail === user.email || dealAccess !== null;
}

const NOT_FOUND = () => Response.json({ error: "Deal not found." }, { status: 404 });

/**
 * Route Handler guard combining auth + deal view access in one call, with
 * the same "404, not 403" convention used throughout this app (see
 * app/api/disputes/[id]/route.ts) — a caller with no legitimate relationship
 * to a deal should not learn that the deal id they guessed or IDOR-probed
 * actually exists. Returns a ready-to-return Response on any failure, or
 * `{ user, access }` on success — mirrors requireUserOrResponse's contract.
 */
export async function requireDealAccessOrResponse(
  request: Request,
  dealId: number,
): Promise<Response | { user: SessionUser; access: DealViewAccess }> {
  const auth = await requireUserOrResponse(request);
  if (auth instanceof Response) return auth;
  if (!dealId) return NOT_FOUND();
  const access = await resolveDealViewAccess(dealId, auth);
  if (!access) return NOT_FOUND();
  return { user: auth, access };
}
