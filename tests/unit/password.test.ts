import { describe, expect, it } from "vitest";
import { hashPassword, passwordPolicyError, verifyPassword } from "../../lib/auth/password";

describe("lib/auth/password", () => {
  it("round-trips: a hashed password verifies against the same plaintext", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("wrong password entirely", hash)).toBe(false);
  });

  it("produces a self-describing stored format with a fresh salt each time", async () => {
    const a = await hashPassword("same-password-twice");
    const b = await hashPassword("same-password-twice");
    expect(a).not.toBe(b); // different random salts
    expect(a.startsWith("pbkdf2$sha256$")).toBe(true);
    expect(await verifyPassword("same-password-twice", a)).toBe(true);
    expect(await verifyPassword("same-password-twice", b)).toBe(true);
  });

  it("fails closed (returns false, does not throw) for a malformed stored hash", async () => {
    await expect(verifyPassword("anything", "not-a-real-hash")).resolves.toBe(false);
    await expect(verifyPassword("anything", "")).resolves.toBe(false);
    await expect(verifyPassword("anything", "pbkdf2$sha256$notanumber$AA$AA")).resolves.toBe(false);
    await expect(verifyPassword("anything", "bcrypt$sha256$1$AA$AA")).resolves.toBe(false);
    await expect(verifyPassword("anything", "pbkdf2$sha256$210000$AA")).resolves.toBe(false); // too few parts
  });

  it("passwordPolicyError rejects short passwords", () => {
    expect(passwordPolicyError("short")).toBeTruthy();
    expect(passwordPolicyError("123456789")).toBeTruthy(); // 9 chars, one under the minimum
  });

  it("passwordPolicyError accepts a reasonable password", () => {
    expect(passwordPolicyError("a-reasonably-long-passphrase")).toBeNull();
  });

  it("passwordPolicyError rejects an unreasonably long password", () => {
    expect(passwordPolicyError("a".repeat(300))).toBeTruthy();
  });
});
