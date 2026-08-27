// docs/AUDIT.md Priority 1: disputes previously had no deal_parties
// awareness — only the dispute opener or platform staff could ever see a
// case, even about a deal a legitimate counterparty was party to. Proves
// canParticipateInDispute() actually widens this correctly, and only
// along real relationships.
import { describe, expect, it } from "vitest";
import { canParticipateInDispute } from "../../lib/auth/deal-access";
import type { SessionUser } from "../../lib/auth/current-user";

function sessionUser(id: number, email: string): SessionUser {
  return { id, email, displayName: "Test User", platformRole: null, status: "active", emailVerifiedAt: null };
}

describe("lib/auth/deal-access canParticipateInDispute", () => {
  it("grants access to whoever opened the dispute, even with no deal access", () => {
    const dispute = { openedByEmail: "opener@example.com" };
    const result = canParticipateInDispute(dispute, null, sessionUser(1, "opener@example.com"));
    expect(result).toBe(true);
  });

  it("grants access to a user with resolved deal access, even if they didn't open the dispute", () => {
    const dispute = { openedByEmail: "owner@example.com" };
    const dealAccess = { deal: {} as never, reason: "organization_party" as const };
    const result = canParticipateInDispute(dispute, dealAccess, sessionUser(2, "counterparty@example.com"));
    expect(result).toBe(true);
  });

  it("denies a user who neither opened the dispute nor has deal access", () => {
    const dispute = { openedByEmail: "owner@example.com" };
    const result = canParticipateInDispute(dispute, null, sessionUser(3, "stranger@example.com"));
    expect(result).toBe(false);
  });
});
