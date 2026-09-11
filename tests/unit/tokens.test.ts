import { describe, expect, it } from "vitest";
import { generateRawToken, hashToken, isExpired, minutesFromNow } from "../../lib/auth/tokens";

describe("lib/auth/tokens", () => {
  it("hashToken is deterministic for the same input", async () => {
    const raw = generateRawToken();
    expect(await hashToken(raw)).toBe(await hashToken(raw));
  });

  it("hashToken produces different output for different input", async () => {
    const a = await hashToken(generateRawToken());
    const b = await hashToken(generateRawToken());
    expect(a).not.toBe(b);
  });

  it("generateRawToken produces a 64-char hex string (256 bits)", () => {
    const raw = generateRawToken();
    expect(raw).toMatch(/^[0-9a-f]{64}$/);
  });

  it("isExpired reads a past timestamp as expired", () => {
    expect(isExpired(new Date(Date.now() - 1000).toISOString())).toBe(true);
  });

  it("isExpired reads a future timestamp as not expired", () => {
    expect(isExpired(new Date(Date.now() + 60_000).toISOString())).toBe(false);
  });

  it("minutesFromNow produces a timestamp in the future", () => {
    const ts = minutesFromNow(30);
    expect(new Date(ts).getTime()).toBeGreaterThan(Date.now());
    expect(isExpired(ts)).toBe(false);
  });

  it("minutesFromNow(0) is effectively now, not future-proof against isExpired", () => {
    const ts = minutesFromNow(0);
    // Should be right around now; allow a little slack for test execution time.
    expect(new Date(ts).getTime()).toBeGreaterThanOrEqual(Date.now() - 1000);
  });
});
