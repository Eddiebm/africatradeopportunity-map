// Post-build smoke check for the actual built worker — see
// vitest.build-smoke.config.ts for why this needs its own pool config.
// Run via `npm run test:build-smoke` after `npm run build`.
//
// This supersedes the old tests/rendered-html.test.mjs (plain `node
// --test`), which broke for two independent, pre-existing reasons
// (confirmed against the unmodified base commit, neither introduced here):
//
//  1. The built worker now transitively imports `cloudflare:workers` (the
//     real auth system's getCurrentUserFromRequest -> session.ts ->
//     getDb()), which plain Node's ESM loader cannot resolve at all
//     (ERR_UNSUPPORTED_ESM_URL_SCHEME) — exactly the class of failure
//     docs/AUDIT.md §8 named this whole Task 1 to fix. Running inside the
//     Workers pool (real workerd) resolves it, same as everywhere else.
//  2. Its assertion — a `<meta name="codex-preview" content="development">`
//     tag — checked for a marker injected by OpenAI's external "Sites"
//     hosting/preview infrastructure. That string does not appear
//     anywhere in this repo or its node_modules; it was never emitted by
//     this codebase's own code, only by the external Sites wrapper this
//     migration is removing (docs/AUDIT.md's entire premise). The audit
//     already flagged the old test as checking Sites-preview plumbing,
//     "not... any application behavior" — so once past #1, this replaces
//     that dead assertion with one that actually verifies the built page
//     renders real app content on a standalone Cloudflare Worker.
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("built worker (dist/server/index.js)", () => {
  it("renders the homepage with real app content, standalone (no Sites/Dispatch proxy)", async () => {
    const response = await SELF.fetch("http://localhost/", {
      headers: { accept: "text/html" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type") ?? "").toMatch(/^text\/html\b/i);

    const html = await response.text();
    expect(html).toContain("<title>Africa Trade Opportunity Map</title>");
    expect(html).toMatch(/Explore intra-African imports, exports/);
  });
});
