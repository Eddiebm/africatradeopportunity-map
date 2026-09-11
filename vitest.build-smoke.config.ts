import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Runs the *built* worker (dist/server/index.js) inside real workerd,
// separately from vitest.config.ts's source-level unit suite.
//
// Why this exists: tests/rendered-html.test.mjs (plain `node --test`)
// used to be able to import the built worker directly because nothing it
// pulled in touched `cloudflare:workers`. Since the real auth system
// landed (getCurrentUserFromRequest -> session.ts -> getDb() ->
// `cloudflare:workers`), the API routes bundled into dist/server/index.js
// now transitively import it too — so plain Node's ESM loader fails with
// ERR_UNSUPPORTED_ESM_URL_SCHEME on the `cloudflare:` protocol, before the
// test even gets to call `worker.fetch()`. Confirmed pre-existing on
// 5465a6d (unrelated to this change): this is exactly the failure mode
// docs/AUDIT.md §8 predicted for *any* code path touching getDb(), now
// hitting the build-smoke check itself, not just a hypothetical new test.
//
// The fix is the same one Task 1 applied everywhere else: run it inside
// the Workers pool instead. `SELF` (from `cloudflare:test`) is a service
// binding to whatever `main` resolves to below — the actual built worker,
// not a stub — running for real, so `cloudflare:workers` resolves fine.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      main: fileURLToPath(new URL("./dist/server/index.js", import.meta.url)),
      miniflare: {
        // worker/index.ts's fallback path expects an ASSETS Fetcher binding;
        // wrangler.jsonc doesn't declare static-asset config yet (see
        // docs/AUDIT.md §9 blocker #2), so fake it the same way the old
        // plain-Node test did — a 404 stub, since this check only cares
        // about the app-router-rendered "/" response, not static assets.
        serviceBindings: {
          ASSETS: () => new Response("Not found", { status: 404 }),
        },
      },
    }),
  ],
  test: {
    include: ["tests/build-smoke/**/*.test.ts"],
  },
});
