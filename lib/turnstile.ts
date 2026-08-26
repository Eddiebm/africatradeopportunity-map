// Provider-adapter for Cloudflare Turnstile (bot-protection CAPTCHA) on
// public forms. Mirrors the payment-provider-adapter pattern the product
// requires (see lib/email.ts): the app never claims to have verified
// something it did not actually check, and the interface is stable
// regardless of whether a real Turnstile site is connected yet.
//
// No real Turnstile site/secret key is provisioned in this environment (no
// Cloudflare dashboard access) — this file builds the real, correctly-wired
// integration point, not a working end-to-end CAPTCHA.
//
// To connect a real widget: create a Turnstile site at
// dash.cloudflare.com -> Turnstile, then:
//   - `wrangler secret put TURNSTILE_SECRET_KEY` (every real environment)
//   - set NEXT_PUBLIC_TURNSTILE_SITE_KEY (build-time, public) so the client
//     widget renders — see app/register/page.tsx / app/page.tsx.
import { env } from "cloudflare:workers";

export type TurnstileResult = { success: boolean; reason: string };

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Verifies a Turnstile token against Cloudflare's siteverify API.
 *
 * IMPORTANT — this function never fabricates a pass. If there is no secret
 * key configured, or no token was submitted, it returns success:false with
 * a reason that says so plainly: the token was NOT checked, so the result
 * cannot honestly be "verified". Returning {success:true} in that situation
 * would make the audit trail lie about what was actually reviewed (the same
 * ethic app/admin/page.tsx's footer states for evidence review generally).
 *
 * Whether an honest "not verified" result should actually BLOCK the request
 * is a separate policy decision — see `turnstileEnforced()` below — because
 * this environment has no real secret key yet, and failing closed on every
 * local/CI request would make registration and listing-posting permanently
 * broken here. Callers must check `turnstileEnforced()` alongside
 * `result.success`; they must not treat `success:false` alone as "reject".
 */
export async function verifyTurnstile(token: string | undefined, remoteIp: string): Promise<TurnstileResult> {
  const secretKey = env.TURNSTILE_SECRET_KEY;

  if (!secretKey) {
    return {
      success: false,
      reason: "Turnstile is not configured in this environment (no TURNSTILE_SECRET_KEY) — the token was not checked.",
    };
  }
  if (!token) {
    return { success: false, reason: "No Turnstile token was submitted with the request." };
  }

  const params = new URLSearchParams();
  params.set("secret", secretKey);
  params.set("response", token);
  if (remoteIp && remoteIp !== "unknown") params.set("remoteip", remoteIp);

  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params,
    });
    if (!res.ok) {
      return { success: false, reason: `Turnstile siteverify request failed (HTTP ${res.status}).` };
    }
    const data = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    if (data.success === true) {
      return { success: true, reason: "Verified by Cloudflare Turnstile siteverify." };
    }
    const codes = data["error-codes"]?.join(", ") || "unspecified";
    return { success: false, reason: `Turnstile siteverify rejected the token (${codes}).` };
  } catch (err) {
    return {
      success: false,
      reason: `Turnstile siteverify request errored: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Fail-open/fail-closed policy for the *unconfigured* case.
 *
 * Enforcement (i.e. an unsuccessful verifyTurnstile() result actually
 * rejects the request with 400) is ON whenever either is true:
 *   - a real TURNSTILE_SECRET_KEY is configured — verification genuinely
 *     ran, so an honest failure must block the request; or
 *   - this is a production build (`process.env.NODE_ENV === "production"`,
 *     the standard Next/vinext build-time flag — "production" for
 *     `vinext build`/deploy, "development" for `vinext dev`, "test" under
 *     vitest; inlined at build time, so this is a compile-time constant in
 *     the deployed Worker, not a runtime env lookup).
 *
 * Enforcement is OFF only when neither is true: no secret key AND not a
 * production build. That is exactly this environment's current state (no
 * Cloudflare dashboard access, so no real key exists yet) — local dev, CI,
 * and preview builds without a configured key must not be permanently
 * blocked from registering a user or posting a classified. This does NOT
 * make verifyTurnstile() report success; it stays honestly false. It only
 * means the caller chooses not to reject on that honest "not checked"
 * result while running as a non-production build with no key.
 *
 * Net effect: a production deploy that forgets to set the secret fails
 * CLOSED (protects the most abuse-prone endpoints by default); a
 * dev/CI/test run with no key fails OPEN (stays usable).
 */
export function turnstileEnforced(): boolean {
  return Boolean(env.TURNSTILE_SECRET_KEY) || process.env.NODE_ENV === "production";
}
