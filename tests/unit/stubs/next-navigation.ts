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
export function redirect(...args: unknown[]): never {
  void args;
  throw new Error("next/navigation redirect() stub called — this test should not exercise Server Component guards.");
}
