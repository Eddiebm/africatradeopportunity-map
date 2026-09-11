// Production-hardening audit follow-up (docs/production-readiness.md): "no
// account-deletion flow" was flagged as a real gap. Design, confirmed by
// the account owner:
//
//  1. Self-service REQUEST, not an instant delete. A user with no open
//     deal, dispute, or exception gets auto-processed after a short grace
//     period (ACCOUNT_DELETION_GRACE_PERIOD_HOURS) — long enough to cancel
//     an accidental click or recover from a hijacked account, short enough
//     to actually be "self-service."
//  2. A user WITH an open deal, dispute, or exception is held for admin
//     review instead of auto-processing — this stops someone deleting
//     their way out of an active dispute or a live counterparty
//     relationship. See checkOpenAccountActivity() for exactly what counts.
//  3. Deletion means ANONYMIZE, not hard-delete. The users row itself is
//     scrubbed (email, display name, password, platform role) and every
//     session revoked — but deals/disputes/verifications/adminAuditEvents
//     this user is named in are left untouched. This matches the 3-year
//     audit-retention window already in place (lib/audit-retention.ts) —
//     a hard delete would let someone delete their way out of that window
//     — and this codebase's own "never silently drop a real recorded fact"
//     convention (see lib/landed-cost.ts, lib/verification-levels.ts):
//     a deal's historical ownerEmail, a dispute's openedByEmail, an admin
//     audit entry's actorUserId are real facts about what happened, not
//     live PII this table can quietly rewrite without falsifying history.
//
// Scope boundary, stated plainly rather than silently: this does NOT scrub
// the user's old email out of deals.ownerEmail, disputes.openedByEmail,
// milestones/landedCostEntries "recordedByEmail" fields, etc. — this app
// stores those as plain historical text, not a foreign key to `users`,
// specifically so a deal's record of who created it survives independent
// of the live account (the same reason adminAuditEvents.actorUserId is
// never rewritten when an admin's own display name changes). Scrubbing
// every historical email column across this schema would mean rewriting
// facts other users' own deal/dispute records depend on, which is a much
// larger, separate decision this session was not asked to make — flagged
// here as an explicit open question, not a corner cut silently.
import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { getDb } from "../db";
import { accountDeletionRequests, adminAuditEvents, deals, disputes, exceptions, organizationMembers, users } from "../db/schema";
import { hashPassword } from "./auth/password";
import { revokeAllSessionsForUser } from "./auth/session";

export const ACCOUNT_DELETION_GRACE_PERIOD_HOURS = 24;

function scheduledForFrom(now: Date): string {
  return new Date(now.getTime() + ACCOUNT_DELETION_GRACE_PERIOD_HOURS * 60 * 60 * 1000).toISOString();
}

/** Real, currently-open reasons this account cannot be auto-deleted right
 * now — an empty array means clear. Every check reads a REAL existing
 * table this platform already writes, the same "never fabricate a signal"
 * discipline lib/exceptions.ts's detectors follow. */
export async function checkOpenAccountActivity(userEmail: string, userId: number): Promise<string[]> {
  const db = getDb();
  const reasons: string[] = [];

  const openDeals = await db.select({ id: deals.id, reference: deals.reference, stage: deals.stage }).from(deals).where(and(eq(deals.ownerEmail, userEmail), ne(deals.stage, "closed")));
  for (const d of openDeals) reasons.push(`Open deal ${d.reference} (stage: ${d.stage.replaceAll("_", " ")})`);

  const openDisputes = await db
    .select({ id: disputes.id, reference: disputes.reference, status: disputes.status })
    .from(disputes)
    .where(and(or(eq(disputes.openedByEmail, userEmail), eq(disputes.respondentEmail, userEmail)), ne(disputes.status, "resolved"), ne(disputes.status, "closed")));
  for (const d of openDisputes) reasons.push(`Open dispute ${d.reference} (status: ${d.status})`);

  // Exceptions tied to either this user's own deals or an organization
  // they're an active member of — a deleted account should not leave an
  // exception silently orphaned with no one able to act on it.
  const ownDealIds = openDeals.map((d) => d.id);
  const memberships = await db.select({ organizationId: organizationMembers.organizationId }).from(organizationMembers).where(and(eq(organizationMembers.userId, userId), isNull(organizationMembers.removedAt)));
  const orgIds = memberships.map((m) => m.organizationId);

  const exceptionConditions = [];
  if (ownDealIds.length) exceptionConditions.push(inArray(exceptions.dealId, ownDealIds));
  if (orgIds.length) exceptionConditions.push(inArray(exceptions.organizationId, orgIds));
  if (exceptionConditions.length) {
    const openExceptions = await db
      .select({ id: exceptions.id, summary: exceptions.summary })
      .from(exceptions)
      .where(and(or(...exceptionConditions), or(eq(exceptions.status, "open"), eq(exceptions.status, "in_progress"))));
    for (const e of openExceptions) reasons.push(`Open exception #${e.id}: ${e.summary}`);
  }

  return reasons;
}

export interface AccountDeletionRequestRow {
  id: number;
  userId: number;
  requestedAt: string;
  status: string;
  scheduledFor: string | null;
  heldReason: string;
}

/** Self-service entry point (see app/api/account/deletion-request/route.ts).
 * Idempotent: calling this again while a request is still pending or held
 * for review just returns the existing one rather than creating a second. */
export async function requestAccountDeletion(userId: number): Promise<AccountDeletionRequestRow> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error("User not found.");

  const [existing] = await db
    .select()
    .from(accountDeletionRequests)
    .where(and(eq(accountDeletionRequests.userId, userId), or(eq(accountDeletionRequests.status, "pending"), eq(accountDeletionRequests.status, "held_for_review"))))
    .limit(1);
  if (existing) return existing;

  const now = new Date();
  const reasons = await checkOpenAccountActivity(user.email, user.id);

  const [row] = await db
    .insert(accountDeletionRequests)
    .values(
      reasons.length
        ? { userId, status: "held_for_review", heldReason: reasons.join("; ") }
        : { userId, status: "pending", scheduledFor: scheduledForFrom(now) },
    )
    .returning();

  await db.update(users).set({ deletionRequestedAt: now.toISOString(), updatedAt: now.toISOString() }).where(eq(users.id, userId));
  return row;
}

/** Self-service cancellation — only while nothing has been decided or
 * completed yet. Keeps the request row (never deletes it — it's itself an
 * audit fact: this user did ask, and then withdrew), just marks it
 * cancelled and clears the "requested" flag on the user record. */
export async function cancelAccountDeletion(userId: number): Promise<boolean> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(accountDeletionRequests)
    .where(and(eq(accountDeletionRequests.userId, userId), or(eq(accountDeletionRequests.status, "pending"), eq(accountDeletionRequests.status, "held_for_review"))))
    .limit(1);
  if (!existing) return false;

  const now = new Date().toISOString();
  await db.update(accountDeletionRequests).set({ status: "cancelled", decidedAt: now, decisionReason: "Withdrawn by the account holder." }).where(eq(accountDeletionRequests.id, existing.id));
  await db.update(users).set({ deletionRequestedAt: null, updatedAt: now }).where(eq(users.id, userId));
  return true;
}

/** The actual, irreversible step: scrub PII off the users row, drop any
 * platform role, and revoke every session. See this module's header
 * comment for exactly what this does and does NOT touch. */
async function anonymizeUser(userId: number): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const randomPassword = await hashPassword(crypto.randomUUID() + crypto.randomUUID());
  await db
    .update(users)
    .set({
      email: `deleted-user-${userId}@deleted.tradesafeafrica.invalid`,
      displayName: "Deleted user",
      passwordHash: randomPassword,
      platformRole: null,
      status: "deleted",
      updatedAt: now,
    })
    .where(eq(users.id, userId));
  await revokeAllSessionsForUser(userId);
}

/** Cron backstop (worker/index.ts's account-deletion-sweep) — also safe to
 * call on demand. Re-checks open activity at EXECUTION time, not just
 * request time: a deal opened in the intervening grace period must still
 * hold the deletion, not slip through because the check only ran once. */
export async function processDueAccountDeletions(now: Date = new Date()): Promise<{ processed: number; stillPending: number; heldNow: number }> {
  const db = getDb();
  const nowIso = now.toISOString();
  const due = await db.select().from(accountDeletionRequests).where(and(eq(accountDeletionRequests.status, "pending")));

  let processed = 0;
  let heldNow = 0;
  for (const request of due) {
    if (!request.scheduledFor || request.scheduledFor > nowIso) continue;
    const [user] = await db.select().from(users).where(eq(users.id, request.userId)).limit(1);
    if (!user) continue;

    const reasons = await checkOpenAccountActivity(user.email, user.id);
    if (reasons.length) {
      await db
        .update(accountDeletionRequests)
        .set({ status: "held_for_review", heldReason: reasons.join("; ") })
        .where(eq(accountDeletionRequests.id, request.id));
      heldNow += 1;
      continue;
    }

    await anonymizeUser(user.id);
    await db.update(accountDeletionRequests).set({ status: "completed", completedAt: nowIso }).where(eq(accountDeletionRequests.id, request.id));
    // Self-action, not an admin decision — actorUserId is still a real,
    // valid reference (the anonymized row itself), matching how every
    // other adminAuditEvents row records who a change happened to.
    await db.insert(adminAuditEvents).values({ actorUserId: user.id, action: "account_deletion_completed", entityType: "user", entityId: user.id, toStatus: "deleted", reason: "Automatic anonymization after the grace period elapsed with no open deal, dispute, or exception." });
    processed += 1;
  }

  const stillPending = await db.select({ id: accountDeletionRequests.id }).from(accountDeletionRequests).where(eq(accountDeletionRequests.status, "pending"));
  return { processed, stillPending: stillPending.length, heldNow };
}

/** Admin decision on a held_for_review request. approve executes the
 * anonymization immediately — an admin approving a held request has, by
 * definition, already reviewed the open items and decided to proceed
 * despite them (that's the entire point of the manual-review path); deny
 * leaves the account untouched. Both require a reason, matching every
 * other admin-decision route in this codebase (see app/api/admin/
 * exceptions/route.ts). */
export async function decideHeldAccountDeletion(requestId: number, admin: { id: number; email: string }, decision: "approved" | "denied", reason: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = getDb();
  const [request] = await db.select().from(accountDeletionRequests).where(eq(accountDeletionRequests.id, requestId)).limit(1);
  if (!request) return { ok: false, error: "Not found." };
  if (request.status !== "held_for_review") return { ok: false, error: "This request is not awaiting review." };

  const now = new Date().toISOString();
  if (decision === "denied") {
    await db.update(accountDeletionRequests).set({ status: "denied", decidedByEmail: admin.email, decidedAt: now, decisionReason: reason }).where(eq(accountDeletionRequests.id, requestId));
    await db.update(users).set({ deletionRequestedAt: null, updatedAt: now }).where(eq(users.id, request.userId));
    await db.insert(adminAuditEvents).values({ actorUserId: admin.id, action: "account_deletion_denied", entityType: "user", entityId: request.userId, fromStatus: "held_for_review", toStatus: "denied", reason });
    return { ok: true };
  }

  await anonymizeUser(request.userId);
  await db.update(accountDeletionRequests).set({ status: "completed", decidedByEmail: admin.email, decidedAt: now, decisionReason: reason, completedAt: now }).where(eq(accountDeletionRequests.id, requestId));
  await db.insert(adminAuditEvents).values({ actorUserId: admin.id, action: "account_deletion_approved", entityType: "user", entityId: request.userId, fromStatus: "held_for_review", toStatus: "deleted", reason });
  return { ok: true };
}
