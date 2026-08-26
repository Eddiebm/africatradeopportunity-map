// Test-only stub for `next/headers`, aliased in vitest.config.ts.
// See tests/unit/stubs/next-navigation.ts for why this exists.
export async function cookies(): Promise<{ get(_name: string): { value: string } | undefined }> {
  throw new Error("next/headers cookies() stub called — this test should not exercise Server Component guards.");
}
