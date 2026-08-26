import { describe, expect, it } from "vitest";
import { SESSION_COOKIE_NAME } from "../../lib/auth/session";

describe("Workers pool smoke test", () => {
  it("imports a module that pulls in cloudflare:workers without failing module resolution", () => {
    expect(SESSION_COOKIE_NAME).toBe("ts_session");
  });
});
