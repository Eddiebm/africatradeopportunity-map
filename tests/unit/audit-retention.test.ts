// Production-hardening audit follow-up (docs/production-readiness.md): "no
// audit-log retention policy" — proves the confirmed 3-year window is
// actually enforced (old rows really go, recent rows really stay), that
// the format mismatch between SQLite's `CURRENT_TIMESTAMP` default and
// `Date.prototype.toISOString()` doesn't silently break the comparison
// (see lib/audit-retention.ts's cutoffTimestamp header comment), and that
// no OTHER table — specifically a real, load-bearing fact table like
// organizationVerifications — is ever touched by this purge.
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import { adminAuditEvents, organizationVerifications, organizations, securityEvents, users } from "../../db/schema";
import { AUDIT_LOG_RETENTION_DAYS, purgeExpiredAuditRecords } from "../../lib/audit-retention";
import { recordOrganizationVerification } from "../../lib/verification-levels";

async function makeUser(email: string) {
  const db = getDb();
  const [row] = await db.insert(users).values({ email, passwordHash: "pbkdf2$sha256$1$AA$AA", displayName: "Test" }).returning({ id: users.id });
  return row.id;
}

// SQLite's own datetime format (space, no millis, no "Z") — the exact
// shape both securityEvents.createdAt and adminAuditEvents.createdAt are
// really written in by their default(sql`CURRENT_TIMESTAMP`), which
// neither insert path in this codebase ever overrides.
function sqliteTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

describe("lib/audit-retention purgeExpiredAuditRecords", () => {
  beforeEach(async () => {
    const db = getDb();
    await db.delete(organizationVerifications);
    await db.delete(adminAuditEvents);
    await db.delete(securityEvents);
    await db.delete(organizations);
    await db.delete(users);
  });

  it("deletes a securityEvents row older than the 3-year window and keeps a recent one", async () => {
    const db = getDb();
    const now = new Date("2026-09-11T12:00:00.000Z");
    const wellPastCutoff = new Date(now.getTime() - (AUDIT_LOG_RETENTION_DAYS + 30) * 86_400_000);
    const wellWithinWindow = new Date(now.getTime() - 10 * 86_400_000);

    await db.insert(securityEvents).values({ eventType: "login_success", email: "old@example.com", createdAt: sqliteTimestamp(wellPastCutoff) });
    await db.insert(securityEvents).values({ eventType: "login_success", email: "recent@example.com", createdAt: sqliteTimestamp(wellWithinWindow) });

    const result = await purgeExpiredAuditRecords(now);
    expect(result.securityEventsDeleted).toBe(1);

    const remaining = await db.select().from(securityEvents);
    expect(remaining.length).toBe(1);
    expect(remaining[0].email).toBe("recent@example.com");
  });

  it("deletes an adminAuditEvents row older than the 3-year window and keeps a recent one", async () => {
    const db = getDb();
    const userId = await makeUser("admin@example.com");
    const now = new Date("2026-09-11T12:00:00.000Z");
    const wellPastCutoff = new Date(now.getTime() - (AUDIT_LOG_RETENTION_DAYS + 30) * 86_400_000);
    const wellWithinWindow = new Date(now.getTime() - 10 * 86_400_000);

    await db.insert(adminAuditEvents).values({ actorUserId: userId, action: "old_action", entityType: "deal", entityId: 1, reason: "x", createdAt: sqliteTimestamp(wellPastCutoff) });
    await db.insert(adminAuditEvents).values({ actorUserId: userId, action: "recent_action", entityType: "deal", entityId: 2, reason: "x", createdAt: sqliteTimestamp(wellWithinWindow) });

    const result = await purgeExpiredAuditRecords(now);
    expect(result.adminAuditEventsDeleted).toBe(1);

    const remaining = await db.select().from(adminAuditEvents);
    expect(remaining.length).toBe(1);
    expect(remaining[0].action).toBe("recent_action");
  });

  it("NEVER touches organizationVerifications — a real recorded fact, not a pure log — even when it's years old", async () => {
    const db = getDb();
    const [org] = await db.insert(organizations).values({ ownerEmail: "org@example.com", legalName: "Old Org", country: "Ghana" }).returning();
    await recordOrganizationVerification({
      organizationId: org.id, levelKey: "identity", whatWasChecked: "x", performedByEmail: "a@example.com",
      source: "s", reviewerEmail: "r@example.com", humanReviewRequired: false, result: "passed",
    });
    // Backdate it directly — recordOrganizationVerification always stamps
    // "now", so this simulates a genuinely old fact the same way the
    // securityEvents/adminAuditEvents tests above do.
    const wellPastCutoff = sqliteTimestamp(new Date(Date.now() - (AUDIT_LOG_RETENTION_DAYS + 365) * 86_400_000));
    await db.update(organizationVerifications).set({ checkedAt: wellPastCutoff }).where(eq(organizationVerifications.organizationId, org.id));

    await purgeExpiredAuditRecords();

    const remaining = await db.select().from(organizationVerifications).where(eq(organizationVerifications.organizationId, org.id));
    expect(remaining.length).toBe(1); // untouched — this purge only ever deletes from the two pure log tables
  });

  it("the returned cutoff is real 3-year-ago, in SQLite's own format", async () => {
    const now = new Date("2026-09-11T12:00:00.000Z");
    const result = await purgeExpiredAuditRecords(now);
    expect(result.cutoff).toBe(sqliteTimestamp(new Date(now.getTime() - AUDIT_LOG_RETENTION_DAYS * 86_400_000)));
    expect(result.cutoff).not.toContain("T"); // proves this is SQLite format, not toISOString()'s
  });
});
