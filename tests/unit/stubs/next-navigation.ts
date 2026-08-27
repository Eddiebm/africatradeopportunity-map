// Test-only stub for `next/navigation`, aliased in vitest.config.ts.
//
// lib/auth/current-user.ts imports `redirect` at module scope for its
// Server-Component guards (getCurrentUser/requireUser/requirePlatformRole).
// These tests exercise only the Route Handler guards
// (requireUserOrResponse/requirePlatformRoleOrResponse), which never call
// `redirect`, but importing the module still needs a `redirect` binding —
// and Next's real `next/navigation` throws outside an actual App Router
// server-rendering context, which Miniflare's bare test worker is not. If
// a test ever calls the Server Component guards and hits this, it'll throw
// loudly (not silently redirect) so a real regression is still caught.
//
// Priority 10 (docs/production-readiness.md): app/link/[token]/page.tsx is
// a real Server Component that DOES call redirect() as its actual,
// intended behavior (hand off to the real auth-gated destination page —
// see that file's header). The thrown error's message carries the
// destination (`NEXT_REDIRECT:<url>`) specifically so a test can assert on
// where it redirected to, same "throw loudly, never silently swallow"
// contract as before — nothing in this repo string-matches the old exact
// message (checked before changing it).
export function redirect(url?: string, ...rest: unknown[]): never {
  void rest;
  throw new Error(`NEXT_REDIRECT:${url ?? ""}`);
}
