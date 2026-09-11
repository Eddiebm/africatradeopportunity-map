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

// script-src carries a per-request nonce (see proxy() below) rather than
// 'unsafe-inline'. This isn't optional here: vinext's App Router SSR
// delivers React 19's RSC hydration payload as bare inline <script> tags
// with no src= attribute on every single page
// (node_modules/vinext/dist/server/app-rsc-handler.js) — without a nonce
// (or 'unsafe-inline', which we deliberately don't use), the browser
// refuses every one of those scripts and no client-side JS runs anywhere
// in the app. vinext has a built-in nonce-extraction mechanism
// (node_modules/vinext/dist/server/csp.js) that parses the nonce straight
// out of the Content-Security-Policy header this proxy sets on its
// response and stamps it onto the scripts it emits — no app-level
// wiring beyond generating the nonce and putting it in this header.
// 'strict-dynamic' lets scripts *inserted by* an already-trusted script
// run without their own nonce or a host-allowlist entry — this is what
// lets Next's <Script> component load the Cloudflare Turnstile widget
// (lib/turnstile.ts) at runtime. https://challenges.cloudflare.com stays
// listed too as a fallback for the few browsers that don't support
// strict-dynamic.
function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com${isDev ? " 'unsafe-eval'" : ""}`,
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
}

function withSecurityHeaders(response: NextResponse, csp: string): NextResponse {
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return response;
}

export function proxy(request: NextRequest) {
  // A fresh nonce every request — predictability is what makes a nonce
  // useless (see the CSP guide at
  // node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
  // crypto.randomUUID() is available in both the Cloudflare Workers runtime
  // and the local dev server; base64-encoding it matches the nonce shape
  // vinext's/Next's header parser expects.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  if (request.nextUrl.pathname.startsWith("/api/") && MUTATING_METHODS.has(request.method)) {
    const origin = request.headers.get("origin");
    if (origin && origin !== request.nextUrl.origin) {
      return withSecurityHeaders(
        NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 }),
        csp,
      );
    }
  }

  // Also thread the nonce onto the forwarded request headers (the
  // documented Next.js pattern) so any Server Component that reads
  // headers() directly can see it, even though vinext's own nonce
  // extraction only actually requires it on the response (see comment
  // above buildCsp).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  return withSecurityHeaders(NextResponse.next({ request: { headers: requestHeaders } }), csp);
}

export const config = {
  matcher: [
    // Skip static assets and the vinext image-optimization endpoint —
    // security headers on those are handled by the asset/CDN layer, and
    // running middleware on every asset request adds latency for nothing.
    "/((?!_next/static|_vinext|favicon.ico).*)",
  ],
};
