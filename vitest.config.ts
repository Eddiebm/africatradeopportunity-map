import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Runs the unit/integration suite inside Miniflare (workerd), not plain
// Node — required because db/index.ts, lib/auth/session.ts, and the
// document route files import `cloudflare:workers`, a Workers-runtime-only
// module scheme that plain `node --test`/Node-pool Vitest cannot resolve.
// See docs/AUDIT.md §8 and §10 item 6.
const migrationsPath = fileURLToPath(new URL("./drizzle", import.meta.url));

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      // The `drizzle/*.sql` files are read here (at config time, in Node)
      // and handed to Miniflare as a JSON binding (`TEST_MIGRATIONS`); the
      // setup file below then applies them to the in-memory D1 instance
      // from inside the worker via `applyD1Migrations` (`cloudflare:test`).
      // This is what gives session.test.ts a real `sessions`/`users`
      // schema instead of an empty D1 database.
      const migrations = await readD1Migrations(migrationsPath);
      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        // Override wrangler.jsonc's `main` (worker/index.ts, the app's real
        // vinext entrypoint) with a trivial stub — see test-worker.ts.
        main: fileURLToPath(new URL("./tests/unit/test-worker.ts", import.meta.url)),
        miniflare: {
          bindings: {
            // Normally from `.dev.vars` (local) / `wrangler secret put`
            // (prod) — both external to a clean checkout, so CI needs this
            // set explicitly rather than relying on `.dev.vars` existing.
            SESSION_SECRET: "test-only-session-secret-do-not-use-in-prod",
            TEST_MIGRATIONS: migrations,
          },
        },
      };
    }),
  ],
  resolve: {
    alias: {
      // lib/auth/current-user.ts imports these for its Server Component
      // guards (redirect/cookies); both throw outside a real Next.js
      // App Router request context, which the bare test worker is not.
      // The Route Handler guards these tests exercise never call them —
      // see tests/unit/stubs/*.ts.
      "next/navigation": fileURLToPath(new URL("./tests/unit/stubs/next-navigation.ts", import.meta.url)),
      "next/headers": fileURLToPath(new URL("./tests/unit/stubs/next-headers.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    setupFiles: ["./tests/unit/apply-migrations.ts"],
  },
});
