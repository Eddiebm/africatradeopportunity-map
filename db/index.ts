import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Declare it in wrangler.jsonc (d1_databases[].binding = \"DB\") and provision a real database with `wrangler d1 create`, or run under `vinext dev` / `wrangler dev` which reads that binding automatically."
    );
  }

  return drizzle(env.DB, { schema });
}
