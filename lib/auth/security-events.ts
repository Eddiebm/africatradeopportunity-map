// Priority 2 (docs/production-readiness.md): audit logging for
// authentication events — login success/failure, logout, registration,
// password-reset request/completion. See db/schema.ts's securityEvents
// table for the full rationale.
//
// SAFETY CONTRACT — this file exists specifically so an incident
// responder can read this table without it becoming a new liability:
//   - NEVER log a password (plaintext or hashed), a raw or hashed session
//     token/cookie value, a raw or hashed password-reset/email-verification
//     token, or any deal/document evidence content.
//   - `details` is for short, human-readable context ("account suspended",
//     "unknown email or wrong password") — never structured secrets.
// Every call site in app/api/auth/* was written to respect this; if you
// add a new call site, keep respecting it.
//
// Logging must never break the actual auth flow it's observing — a
// failure to write an audit row is swallowed (and reported to
// console.error, the only observability a Worker has outside a real log
// sink) rather than turning into a 500 on a legitimate login/logout/etc.
import { getDb } from "../../db";
import { securityEvents, type SecurityEventType } from "../../db/schema";

export async function logSecurityEvent(
  eventType: SecurityEventType,
  opts: { email?: string; ip?: string; userAgent?: string; details?: string } = {},
): Promise<void> {
  try {
    const db = getDb();
    await db.insert(securityEvents).values({
      eventType,
      email: (opts.email ?? "").trim().toLowerCase(),
      ip: opts.ip ?? "",
      userAgent: opts.userAgent ?? "",
      details: opts.details ?? "",
    });
  } catch (error) {
    console.error(`[security-events] failed to log ${eventType}:`, error);
  }
}
