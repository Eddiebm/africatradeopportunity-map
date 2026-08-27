// docs/AUDIT.md §5 item 5: "Document download is owner-only, not
// participant-aware. ... dealParties exists in the schema for
// counterparties but is never consulted — a legitimate counterparty or
// assigned verification analyst has no path to view deal documents."
//
// This resolves who may VIEW a deal (the deal room, its documents) — not
// who may ACT within it. Submitting evidence, uploading documents,
// accepting/declining quotes, and reporting milestone evidence stay
// owner-only actions everywhere else in the app; extending write access to
// counterparties is a separate product decision this audit item didn't ask
// for, and changing it here would be scope creep on a security fix. This
// module only ever widens *read* access, and only along DB-backed
// relationships — nothing here trusts a client-supplied dealId, email, or
// role (see lib/auth/current-user.ts's contract).
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../db";
import { deals, dealParties, organizationMembers } from "../../db/schema";
import type { SessionUser } from "./current-user";

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
 *   3. A deal_parties row for this deal whose organizationId matches one
 *      of the user's *active* organization memberships.
 *   4. A deal_parties row whose freeform `contact` field case-insensitively
 *      matches the user's account email — the fallback for a party
 *      recorded before they had an account, or one never linked to an
 *      organization at all.
 */
export async function resolveDealViewAccess(dealId: number, user: SessionUser): Promise<DealViewAccess | null> {
  const db = getDb();
  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId)).limit(1);
  if (!deal) return null;

  if (deal.ownerEmail === user.email) return { deal, reason: "owner" };

  if (user.platformRole === "administrator" || user.platformRole === "verification_analyst") {
    return { deal, reason: "platform_role" };
  }

  const parties = await db.select().from(dealParties).where(eq(dealParties.dealId, dealId));
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
