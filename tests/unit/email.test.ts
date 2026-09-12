// Launch-prep (docs/production-readiness.md): the account owner picked
// Resend once the app actually went live. RESEND_API_KEY is not set in the
// test worker's bindings (vitest.config.ts), so getEmailProvider() itself
// only ever proves the ConsoleEmailProvider fallback here — the real
// Resend HTTP call/response-handling logic in ResendEmailProvider is
// exercised directly, against a mocked global fetch, so these tests prove
// real behavior (a real request shape, real success/failure parsing)
// without making a real network call to Resend.
import { afterEach, describe, expect, it, vi } from "vitest";
import { getEmailProvider, ResendEmailProvider, DEFAULT_EMAIL_FROM } from "../../lib/email";

describe("lib/email — ConsoleEmailProvider fallback", () => {
  it("getEmailProvider() falls back to console when RESEND_API_KEY is unset (as in this test worker)", async () => {
    const provider = getEmailProvider();
    expect(provider.name).toBe("console");

    const result = await provider.send({ to: "trader@example.com", subject: "Reset your password", text: "Link: https://example.com/reset/abc" });
    expect(result.delivered).toBe(false);
    expect(result.provider).toBe("console");
    expect(result.detail).toMatch(/no email provider is connected/i);
  });
});

describe("lib/email — ResendEmailProvider (mocked fetch, real request/response handling)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a real-shaped request to Resend's API and honestly reports success on a 200", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.resend.com/emails");
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer re_test_key");
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({
        from: DEFAULT_EMAIL_FROM,
        to: ["trader@example.com"],
        subject: "Reset your password",
        text: "Link: https://example.com/reset/abc",
      });
      return new Response(JSON.stringify({ id: "re_abc123" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new ResendEmailProvider("re_test_key", DEFAULT_EMAIL_FROM);
    const result = await provider.send({ to: "trader@example.com", subject: "Reset your password", text: "Link: https://example.com/reset/abc" });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.delivered).toBe(true);
    expect(result.provider).toBe("resend");
    expect(result.detail).toContain("re_abc123");
  });

  it("honestly reports failure (never fabricates delivered:true) when Resend rejects the send", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ message: "You can only send testing emails to your own email address." }), { status: 403 })),
    );

    const provider = new ResendEmailProvider("re_test_key", "onboarding@resend.dev");
    const result = await provider.send({ to: "someone-else@example.com", subject: "Welcome", text: "Hi" });

    expect(result.delivered).toBe(false);
    expect(result.provider).toBe("resend");
    expect(result.detail).toMatch(/403/);
    expect(result.detail).toMatch(/own email address/i);
  });

  it("honestly reports failure (never fabricates delivered:true) when the network request itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const provider = new ResendEmailProvider("re_test_key", DEFAULT_EMAIL_FROM);
    const result = await provider.send({ to: "trader@example.com", subject: "Welcome", text: "Hi" });

    expect(result.delivered).toBe(false);
    expect(result.provider).toBe("resend");
    expect(result.detail).toMatch(/could not reach resend/i);
    expect(result.detail).toContain("network down");
  });
});
