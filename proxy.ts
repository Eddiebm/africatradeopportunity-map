import { NextRequest, NextResponse } from "next/server";

// Runs on every request. Two jobs:
//  1. Security headers on every response.
//  2. A same-origin check on mutating API requests, as defense-in-depth
//     against cross-site request forgery. The session cookie is already
//     SameSite=Strict (see lib/auth/session.ts), which stops a browser from
//     attaching it to a cross-site request in the first place on modern
//     browsers — this check is a second layer for older browsers and for
//     requests that somehow carry the cookie without being same-site.
//
// This does NOT do rate limiting — that stays per-route (see
// lib/auth/rate-limit.ts) because it needs D1 access, which isn't reachable
// from every code path middleware can run in. Production deployments should
// also configure Cloudflare's edge Rate Limiting / WAF rules independently
// of anything in this file.

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const CSP = [
  "default-src 'self'",
  // https://challenges.cloudflare.com serves both the Turnstile widget
  // script and the challenge iframe (lib/turnstile.ts +
  // NEXT_PUBLIC_TURNSTILE_SITE_KEY) — harmless to allow even before a real
  // site key is configured, since the widget just doesn't render then.
  "script-src 'self' https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  // Inline `style` attributes are used by a handful of pages for small
  // one-off layout tweaks (not a general escape hatch for untrusted
  // content — nothing user-supplied is ever rendered as a style attribute).
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

function withSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set("Content-Security-Policy", CSP);
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return response;
}

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/") && MUTATING_METHODS.has(request.method)) {
    const origin = request.headers.get("origin");
    if (origin && origin !== request.nextUrl.origin) {
      return withSecurityHeaders(
        NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 }),
      );
    }
  }
  return withSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: [
    // Skip static assets and the vinext image-optimization endpoint —
    // security headers on those are handled by the asset/CDN layer, and
    // running middleware on every asset request adds latency for nothing.
    "/((?!_next/static|_vinext|favicon.ico).*)",
  ],
};
