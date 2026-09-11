// Applies drizzle/*.sql to the in-memory D1 instance Miniflare gives each
// test worker, before any test file's tests run. See vitest.config.ts for
// how `env.TEST_MIGRATIONS` gets populated.
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";

const testEnv = env as unknown as { DB: D1Database; TEST_MIGRATIONS: D1Migration[] };

await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
