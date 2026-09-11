// Priority 3 (docs/production-readiness.md): "Structured server-side
// error logging" + "Request and correlation IDs." Proves logServerError
// emits one structured JSON line to console.error carrying the
// correlation id and route context, and never throws itself.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logServerError, newCorrelationId } from "../../lib/observability";

describe("lib/observability", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("newCorrelationId returns a fresh UUID-shaped string each call", () => {
    const a = newCorrelationId();
    const b = newCorrelationId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("logs one structured JSON line with the correlation id, route, and error message", () => {
    const id = "test-correlation-id";
    logServerError(id, { method: "POST", pathname: "/api/deals" }, new Error("boom"));

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(logged.correlationId).toBe(id);
    expect(logged.method).toBe("POST");
    expect(logged.pathname).toBe("/api/deals");
    expect(logged.message).toBe("boom");
    expect(typeof logged.timestamp).toBe("string");
  });

  it("handles a non-Error thrown value without throwing itself", () => {
    expect(() => logServerError("id", { method: "GET", pathname: "/x" }, "a plain string error")).not.toThrow();
    const logged = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(logged.message).toBe("a plain string error");
  });
});
