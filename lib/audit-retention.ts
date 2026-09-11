// Production-hardening audit follow-up (docs/production-readiness.md): "no
// audit-log retention policy" was flagged as a real gap — securityEvents
// (lib/auth/security-events.ts) and adminAuditEvents (lib/exceptions.ts and
// every admin-decision route) grew forever with nothing ever removing a
// row. Retention window confirmed by the account owner: 3 years. This
// module is the one place that number is defined and the one place either
// table is ever deleted from — see worker/index.ts's scheduled() handler
// for how it's actually invoked (a daily Cron Trigger tick, alongside the
// other two scheduled jobs), and lib/cron-runs.ts for how every run of it
// is itself recorded (so "did last night's purge actually run" is a query,
// not a hope).
//
// Deliberately NOT applied to any other table. adminAuditEvents and
// securityEvents are the two tables this codebase's own schema comments
// describe as pure operational/security logs with no other purpose — see
// db/schema.ts's header comments on both. Every other "history" table in
// this app (organizationVerifications, dealEvents, corridorTemplates,
// landedCostEntries, exceptions...) is the real, load-bearing append-only
// record this platform's core data model is built on (see this codebase's
// "latest row wins" convention, e.g. lib/verification-levels.ts) — deleting
// from any of those would be deleting real recorded facts, which this
// project's own working rules forbid. Only these two pure log tables are
// ever pruned, and only once a real row has aged past the confirmed window.
import { lt } from "drizzle-orm";
import { getDb } from "../db";
import { adminAuditEvents, securityEvents } from "../db/schema";

// 3 years, expressed in days rather than a calendar calculation — same
// "illustrative, documented, not sourced from an external SLA" honesty
// convention as lib/exceptions.ts's own policy thresholds. Not
// leap-year-exact; a few days of slack either way is immaterial for a
// retention window measured in years, and exactness here would be false
// precision this codebase's own conventions specifically avoid claiming.
export const AUDIT_LOG_RETENTION_DAYS = 3 * 365;

// Both tables' createdAt is written by SQLite's own `CURRENT_TIMESTAMP`
// default (see db/schema.ts) — neither insert path
// (lib/auth/security-events.ts, every admin-decision route) ever sets it
// explicitly — which formats as "YYYY-MM-DD HH:MM:SS" (a space, no
// milliseconds, no trailing "Z"), NOT `Date.prototype.toISOString()`'s
// "YYYY-MM-DDTHH:MM:SS.sssZ". A `<` comparison between two differently
// formatted date strings only agrees with real chronological order once
// their calendar-date prefixes differ, which is true for every row this
// purge is meant to catch (rows years old) but would NOT reliably hold for
// a same-day comparison — so the cutoff is built in the exact same format
// SQLite itself writes, not `toISOString()`, to keep the comparison exact
// rather than "close enough because the window is measured in years."
function cutoffTimestamp(now: Date = new Date()): string {
  const cutoff = new Date(now.getTime() - AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  return cutoff.toISOString().slice(0, 19).replace("T", " ");
}

export interface AuditRetentionResult {
  securityEventsDeleted: number;
  adminAuditEventsDeleted: number;
  cutoff: string;
}

// Exported (not inlined into the cron handler) so tests can call it
// directly against a seeded Miniflare D1, the same pattern every other
// lib/*.ts module in this codebase already follows.
export async function purgeExpiredAuditRecords(now: Date = new Date()): Promise<AuditRetentionResult> {
  const db = getDb();
  const cutoff = cutoffTimestamp(now);

  const deletedSecurityEvents = await db.delete(securityEvents).where(lt(securityEvents.createdAt, cutoff)).returning({ id: securityEvents.id });
  const deletedAdminAuditEvents = await db.delete(adminAuditEvents).where(lt(adminAuditEvents.createdAt, cutoff)).returning({ id: adminAuditEvents.id });

  return {
    securityEventsDeleted: deletedSecurityEvents.length,
    adminAuditEventsDeleted: deletedAdminAuditEvents.length,
    cutoff,
  };
}
