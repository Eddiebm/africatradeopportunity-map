// Launch-prep follow-up (docs/production-readiness.md): self-service data
// EXPORT — the companion this app's own privacy page named as still
// missing once account DELETION (lib/account-deletion.ts) shipped. Same
// "never fabricate, never silently drop a real fact" discipline as every
// other lib/*.ts module here: every field below is a real column from a
// real row this user's own account produced, nothing summarized or
// inferred.
//
// Scope, stated explicitly (mirrors lib/account-deletion.ts's own scope
// note): this exports what is clearly AND UNAMBIGUOUSLY this user's own —
// their profile, the organizations they own or belong to, the deals they
// created, the disputes they opened or were named respondent on, their own
// notifications, and their own login/security-event history. It does NOT
// attempt to reconstruct every row anywhere in the schema that happens to
// mention their email (e.g. a dispute message they posted inside a deal
// they don't own, or a landed-cost entry someone else recorded on a deal
// they're a party to but didn't create) — those live inside another
// party's deal room and exporting them here would mean exporting parts of
// someone ELSE's deal on this user's request, which is its own separate,
// larger access-control question this pass was not asked to resolve.
import { eq, or } from "drizzle-orm";
import { getDb } from "../db";
import { deals, disputes, notifications, organizationMembers, organizations, securityEvents, users } from "../db/schema";

export interface UserDataExport {
  exportedAt: string;
  profile: {
    id: number;
    email: string;
    displayName: string;
    locale: string;
    emailVerifiedAt: string | null;
    termsAcceptedAt: string | null;
    createdAt: string;
  };
  organizations: unknown[];
  organizationMemberships: unknown[];
  deals: unknown[];
  disputes: unknown[];
  notifications: unknown[];
  loginHistory: unknown[];
}

export async function buildUserDataExport(userId: number): Promise<UserDataExport> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error("User not found.");

  const memberships = await db.select().from(organizationMembers).where(eq(organizationMembers.userId, userId));
  const orgIds = memberships.map((m) => m.organizationId);
  // drizzle's `or` requires at least one condition, and always includes
  // ownership; orgIds may additionally be empty for a user who never
  // joined an organization they don't own.
  const ownedOrMemberOrgs = await db
    .select()
    .from(organizations)
    .where(or(eq(organizations.ownerEmail, user.email), ...orgIds.map((id) => eq(organizations.id, id))));

  const ownDeals = await db.select().from(deals).where(eq(deals.ownerEmail, user.email));
  const ownDisputes = await db.select().from(disputes).where(or(eq(disputes.openedByEmail, user.email), eq(disputes.respondentEmail, user.email)));
  const ownNotifications = await db.select().from(notifications).where(eq(notifications.recipientEmail, user.email));
  const loginHistory = await db.select().from(securityEvents).where(eq(securityEvents.email, user.email));

  return {
    exportedAt: new Date().toISOString(),
    profile: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      locale: user.locale,
      emailVerifiedAt: user.emailVerifiedAt,
      termsAcceptedAt: user.termsAcceptedAt,
      createdAt: user.createdAt,
    },
    organizations: ownedOrMemberOrgs,
    organizationMemberships: memberships,
    deals: ownDeals,
    disputes: ownDisputes,
    notifications: ownNotifications,
    loginHistory,
  };
}
