// Priority 2 (docs/production-readiness.md): "Audit logging for sensitive
// actions." Proves logSecurityEvent actually writes a row (against a real
// D1-backed test database) and — the part that matters most — that it
// never throws even when the DB write itself fails, since a logging
// failure must never break a real login/logout/register/reset flow.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../../db";
import { securityEvents } from "../../db/schema";
import { logSecurityEvent } from "../../lib/auth/security-events";

describe("lib/auth/security-events logSecurityEvent", () => {
  beforeEach(async () => {
    const db = getDb();
    await db.delete(securityEvents);
  });

  it("writes a row with the given event type, email, ip, and user agent", async () => {
    await logSecurityEvent("login_success", { email: "Someone@Example.com", ip: "203.0.113.1", userAgent: "TestAgent/1.0" });
    const db = getDb();
    const rows = await db.select().from(securityEvents);
    expect(rows.length).toBe(1);
    expect(rows[0].eventType).toBe("login_success");
    expect(rows[0].email).toBe("someone@example.com"); // normalized, matching every other email comparison in this codebase
    expect(rows[0].ip).toBe("203.0.113.1");
    expect(rows[0].userAgent).toBe("TestAgent/1.0");
  });

  it("records details for a failed login without leaking which check failed (email vs. password)", async () => {
    await logSecurityEvent("login_failed", { email: "x@example.com", ip: "1.2.3.4", details: "unknown email or wrong password" });
    const db = getDb();
    const [row] = await db.select().from(securityEvents);
    expect(row.details).toBe("unknown email or wrong password");
  });

  it("never throws, even when the write itself fails — logging must not break the auth flow it's observing", async () => {
    const db = getDb();
    const spy = vi.spyOn(db, "insert").mockImplementation(() => {
      throw new Error("simulated D1 outage");
    });
    await expect(logSecurityEvent("login_success", { email: "x@example.com" })).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
