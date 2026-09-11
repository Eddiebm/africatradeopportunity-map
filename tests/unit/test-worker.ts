// Minimal Worker entrypoint used only for the Vitest Workers pool.
// The app's real entrypoint (worker/index.ts) pulls in vinext's Vite-RSC
// build pipeline (a `virtual:vinext-rsc-entry` module supplied by the
// `vinext()` Vite plugin in vite.config.ts, not loaded here), which unit
// tests have no need to boot. This stub gives the pool a worker to run
// tests "inside" while still getting the real D1/R2/env bindings declared
// in wrangler.jsonc.
const testWorkerStub = {
  async fetch() {
    return new Response("test-worker stub — not used by any test", { status: 404 });
  },
};

export default testWorkerStub;
