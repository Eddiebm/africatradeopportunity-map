# TradeSafe Africa — Production Readiness Audit

**Date:** 2026-08-26
**Repo:** `eddiebm/africatradeopportunity-map`
**Branch:** `claude/production-tradesafe`
**Commit audited:** `2a1e7c0` ("Import complete TradeSafe Africa codebase") — the repository's only commit.

This audit inspects the codebase as it exists today. It changes no application
code. It exists so implementation work can be sequenced and approved before
any architectural change is made, per the working rules for this engagement.

---

## 1. Current architecture

The app is **not** a standard Next.js-on-Cloudflare-Workers project. It is an
**OpenAI "Sites" scaffold** built on Cloudflare's `vinext` runtime
(`vinext` npm package, `@cloudflare/vite-plugin`, `@vitejs/plugin-rsc`) —
a shim that lets a Next.js App Router codebase run as a Cloudflare Worker
under OpenAI's own hosting product, not under a developer-owned Cloudflare
account.

Concretely:

- **Entry point:** `worker/index.ts` — a Cloudflare Worker `fetch` handler
  that delegates to `vinext/server/app-router-entry` and handles
  `/_vinext/image` image optimization. This part is genuinely
  Workers-compatible and can be kept.
- **Framework:** Next.js App Router (`app/`), React 19, RSC via
  `@vitejs/plugin-rsc`. Pages mix server components (data-fetching pages like
  `app/dashboard/page.tsx`, `app/deal/[id]/page.tsx`) with client components
  (`"use client"` pages like `app/page.tsx`, `app/marketplace/page.tsx`).
- **Build tool:** Vite (`vite.config.ts`), not `next build`. `next.config.ts`
  exists but is nearly empty — Next's own CLI is not the build path.
  `vite.config.ts` hard-imports `./.openai/hosting.json`, a file that
  **does not exist in the repository** (see §9, blocker #1).
- **Database:** Cloudflare D1 via Drizzle ORM (`db/schema.ts`, `db/index.ts`,
  `drizzle/*.sql` migrations). `db/index.ts` reads the binding via
  `env.DB` from `cloudflare:workers`, and throws a descriptive error if the
  binding is absent. This part is standard Workers/D1 usage and portable.
- **Storage:** Cloudflare R2, referenced as `env.BUCKET` (typed only inline
  in one route file; no shared `Env` binding type). Used for deal documents.
- **Authentication:** **Entirely delegated to OpenAI's "Sites" hosting
  platform.** `app/chatgpt-auth.ts` reads identity from a request header
  (`oai-authenticated-user-email`) that only exists because an external
  reverse proxy ("Dispatch", per the README) injects it. The repo owns none
  of the actual sign-in flow — `/signin-with-chatgpt`, `/signout-with-chatgpt`
  and `/callback` are explicitly documented as owned by that external
  infrastructure, not by this codebase. **On a standalone Cloudflare Workers
  deployment, none of this exists — every "authenticated" page and API route
  in the app is currently unauthenticatable.**
- **Styling:** Plain CSS files per route/section (`app/*.css`), imported
  globally from `app/layout.tsx`. Tailwind is a dependency
  (`@tailwindcss/postcss`, `tailwindcss`) but `globals.css` would need
  checking for `@import "tailwindcss"` — most visible UI is hand-written CSS,
  not Tailwind utility classes.
- **Build/dev tooling:** `scripts/sites-env.sh`, `scripts/install-ci.sh`,
  `scripts/build-verified.sh` — these wrap install/build in the OpenAI Sites
  lifecycle (project-local `HOME`, bounded `timeout`, a single non-retrying
  `npm ci`, packaging `dist/.openai/` on build). They assume they are running
  inside the Sites builder, not a generic CI runner or `wrangler deploy`.
- **Testing:** One test (`tests/rendered-html.test.mjs`) that builds the app
  and asserts the built HTML contains a `codex-preview` development meta tag.
  It is a build/deploy smoke check for the Sites preview infrastructure, not
  a test of any application behavior.

**Summary:** the application logic (routes, schema, UI) is a reasonably
serious MVP. The *hosting shell* around it — auth, build lifecycle, config
file lookup, test suite — is entirely OpenAI-Sites-specific and does not run
standalone on Cloudflare today. This is the primary rewrite surface, and
matches exactly what the task description anticipated.

---

## 2. Working features (verified by reading the code paths)

- **Interactive Africa trade atlas** (`app/page.tsx`) — 54-country SVG map,
  per-region supply/demand profiles, editable landed-cost calculator,
  classifieds intake form. Self-contained, no auth required.
- **Live official trade-data lookups**, hitting real free institutional APIs
  at request time, with no caching/persistence layer yet:
  - `app/api/import-intelligence/route.ts` — UN Comtrade (annual + monthly
    import series, partner/supplier breakdown) and World Bank indicators
    (population growth, GDP growth), combined into a heuristic next-year
    forecast with an explicit confidence score and method string.
  - `app/api/official-flow/route.ts` — a narrower UN Comtrade point lookup
    for a single origin→destination→HS-code corridor (currently hardcoded to
    9 West African countries).
  - Both routes are honest in their response payloads: they label estimates
    vs. official figures and include warning strings
    ("Future demand is a projection, not a purchase order.", etc.).
- **Classifieds / market requests** (`app/api/market-requests/route.ts`) —
  public read, public create (auth optional), persisted to D1
  (`market_requests` table), default status `pending_verification`.
- **Deal creation and deal rooms** (`app/api/deals`, `app/deal/[id]`,
  `app/deal/new`) — authenticated create, auto-provisions a cost sheet,
  8 verification checks, 7 required documents, and a 4-stage milestone
  schedule per new deal. Deal room page computes landed cost/profit from
  the cost row and renders evidence/document/milestone/activity state.
- **Document upload/download** (`app/api/deals/[id]/documents/*`) — MIME
  allowlist (PDF/PNG/JPEG), 10MB size cap, **magic-byte validation** (not
  just trusting `Content-Type`), SHA-256 hashing, filename sanitization,
  ownership check before read/write, audit-event rows on upload/download,
  `Cache-Control: private, no-store` on download, R2 object cleanup on DB
  insert failure. This is materially more careful than most MVP upload code.
- **Basic matching** (`app/api/marketplace/route.ts`) — wanted/for-sale
  compatibility, product-name normalization + HS-4 prefix match, route
  match, a "verified" bonus, minimum score threshold, mutual-interest
  consent flow (`demandInterestAt`/`supplyInterestAt`), contact withheld
  until `status === "approved"`.
  scored, explainable breakdown returned to the client.
- **Disputes** (`app/api/disputes`, `app/disputes/page.tsx`) — open a case
  tied to an owned deal, generates a reference, writes a `dealEvents` row and
  a `notifications` row.
- **Notifications** (`app/api/notifications/route.ts`) — per-recipient list,
  mark-all-read.
- **Admin desk** (`app/api/admin/desk/route.ts`, `app/admin/page.tsx`) —
  single-admin review queue for listings, matches, deals, evidence checks,
  documents, with an explicit allow-list of legal status transitions per
  entity type.
- **Drizzle schema and migrations** — 20+ tables already model most of the
  domain the mission describes (deals, deal parties, verification checks,
  documents + document versions + audit events, match candidates, quote
  requests, quotes, introductions, disputes + dispute messages/events,
  notifications, milestones). Foreign keys and timestamps are used
  consistently. See §6 for the gap against the mission's full data model.

---

## 3. Broken or incomplete features

- **`.openai/hosting.json` is imported but does not exist in the repo.**
  `vite.config.ts` does `import hostingConfig from "./.openai/hosting.json"`
  — a hard, non-optional import. **The app cannot currently build or run in
  dev, on this checkout, at all**, independent of any Cloudflare-specific
  concern. This is the single highest-priority blocker (see §9).
- **No login/registration/session system exists in this codebase.** Every
  page that calls `requireChatGPTUser` or checks `getChatGPTUser()` will
  silently treat *every visitor* as anonymous once the `oai-authenticated-*`
  headers stop being injected (i.e., immediately, on any non-OpenAI-Sites
  host). `requireChatGPTUser` redirects to `/signin-with-chatgpt`, a route
  this repo does not implement — that is a 404 today outside OpenAI Sites.
- **Admin authorization is a single hardcoded email string**
  (`app/api/admin/desk/route.ts:6`, `const ADMIN="eddie@bannermanmenson.com"`)
  compared against the (currently unverifiable) identity header. No
  database-backed roles exist anywhere in the schema.
- **Admin match-approval has a filtering bug.** `PATCH /api/admin/desk`
  updates `matchCandidates` with
  `where(eq(matchCandidates.demandRequestId, numericId))` — it matches by
  `demandRequestId`, not by the match's own `id`. If a demand listing ever
  has more than one candidate match, approving one approves all of them.
  The admin UI passes `x.demandRequestId` as the id for exactly this call.
- **Opportunity Finder (`app/opportunities/page.tsx`) is 100% hardcoded
  fictional data** — six baked-in `candidates` with fabricated buy/sell/
  freight/demand/supply/risk numbers, scored and ranked client-side. It is
  not connected to `import-intelligence` or `official-flow` at all, despite
  those two live-data routes existing elsewhere in the app. This directly
  contradicts the mission's core requirement ("replace hard-coded
  opportunities with a persistent, source-aware pipeline") and is the
  biggest gap between what exists and what "Opportunity Finder" is supposed
  to be.
- **The homepage "trade lane finder" is likewise hardcoded** (`app/page.tsx`,
  the `lanes` const) — six fixed West-Africa corridors with fixed dollar
  figures, presented next to genuinely live Comtrade/World Bank data in the
  same page.
- **`app/built/page.tsx` is stale, self-referential meta-commentary**
  written by whatever process originally generated this app ("Was the code
  pushed to github/eddiebm? No.") — it's now factually wrong (the code *is*
  in this repo) and reads as leftover scaffolding rather than product
  content. Should be removed or replaced.
- **`official-flow` only supports 9 hardcoded West African countries**
  (`Ghana, Burkina Faso, Togo, Nigeria, Benin, Côte d'Ivoire, Senegal, Mali,
  Niger`) via an inline `codes` map, while `import-intelligence` and the map
  UI support all 54. Inconsistent coverage between the two "official data"
  surfaces.
- **`market-requests` POST has no rate limiting or bot protection** and
  accepts unauthenticated submissions with a free-text `contact` field —
  an easy spam/scrape vector once public.
- **No organizations/business-profile flow exists** despite `organizations`
  being a full table in the schema — nothing in `app/` creates, edits, or
  reads an organization. Deals and listings are keyed directly to
  `ownerEmail`, not to an org, so the "Organizations / Organization members"
  part of the mission's data model is schema-only, feature-empty.
- **Quotes, quote requests, and introductions tables exist but have no API
  routes or UI** — `quoteRequests`, `quotes`, `introductions` are defined in
  `db/schema.ts` and never referenced anywhere in `app/api/*`. The landed-
  cost fields on `quotes` (goods/freight/border/inspection/insurance/
  finance-FX/other totals, `sourceStatus: party_reported`) suggest this was
  designed to carry the "quotes vs. estimates" distinction the mission
  requires, but it's unwired.
- **No French localization** — no i18n framework, no translation keys; all
  copy is inline English JSX strings.
- **No verification-provider integration point** — "verification" in the
  UI/API is purely an internal status field set by the single hardcoded
  admin; there is no adapter boundary for a real KYC/business-registry
  provider, and no disclaimer route/page saying so (the mission requires one).
- **No payment/escrow code exists at all** — correctly, since the mission
  forbids building one — but there is also no explicit "payments
  unavailable" surface beyond the UI copy already present in
  `app/deal/[id]/page.tsx` ("Licensed partner execution required") and
  `app/page.tsx` ("A licensed bank or payment provider must determine..."),
  which is good practice already followed and should be preserved.
- **Notifications are in-app only, `channel: "in_app"` default** — no
  delivery mechanism (email, etc.) exists despite the schema modeling
  `channel`/`status`/`attempts`/`lastError` for a real delivery pipeline.

---

## 4. Hard-coded or sample data

| Location | What's hardcoded | Risk |
|---|---|---|
| `app/opportunities/page.tsx` | 6 full opportunity records incl. price, demand/supply/risk scores | Presented as the product's flagship "What should I move?" ranking; currently indistinguishable in the UI from a real computed result |
| `app/page.tsx` (`lanes` const) | 6 trade-lane records with fixed $ figures | Sits beside genuinely live Comtrade data on the same page |
| `app/components/ImportIntelligence.tsx` (`products` list) | Curated product/HS list merged with `hs-catalog` | Low risk — it's an input picker, not a claimed result |
| `app/api/official-flow/route.ts` (`codes` map) | 9 countries' Comtrade reporter codes | Should reuse `lib/africa-countries.ts`'s full 54-country map instead of a separate partial one |
| `app/api/admin/desk/route.ts` | `ADMIN="eddie@bannermanmenson.com"` | Single point of failure/privilege; must become DB-backed roles |
| `app/africa-map-data.ts`, `app/page.tsx` (`raw` country stats) | Static country export/import figures, static SVG paths | Reasonable as a base map layer (Natural Earth geometry, cited), but the $ export/import numbers per country have no source citation and should either get one or be clearly labeled as illustrative |
| `app/built/page.tsx` | Entire page is stale meta-commentary, not product content | Should be deleted or replaced with a real "product status" page |

No API keys, credentials, or secrets are hardcoded anywhere in the repo
(checked via pattern search across `.ts`/`.tsx`/`.json`, excluding
`package-lock.json`). Good.

---

## 5. Security weaknesses

1. **Authorization is entirely client-header-trust today.** Every
   "authenticated" check is `getChatGPTUser()` reading one HTTP header. On a
   real Cloudflare Workers deployment with no Dispatch proxy in front of it,
   a client could set `oai-authenticated-user-email` directly on a raw
   request unless something strips it — there is currently **nothing in
   this codebase** that strips or validates that header at the edge. This
   must not simply be reimplemented against a different unverified header;
   it needs real session/JWT verification server-side (see §7).
2. **Single hardcoded admin email**, string-compared, case-normalized only
   on one side — classic "if this one email, you're god" pattern. No
   audit trail records *why* an admin action happened beyond the actor
   email + timestamp already captured in `documentAuditEvents`/`dealEvents`
   (good bones, needs a real role system feeding it).
3. **No rate limiting anywhere** — not on classifieds POST, not on deal
   creation, not on document upload, not on dispute creation. No Turnstile
   or equivalent on any form.
4. **No CSRF protection markers** — mutating routes are plain `POST`/`PATCH`
   JSON handlers with no origin check, no CSRF token. Lower risk while auth
   is header-based rather than cookie-based, but becomes necessary the
   moment real cookie sessions are introduced.
5. **Document download is owner-only, not participant-aware.** The download
   route (`app/api/deals/[id]/documents/[fileId]/route.ts`) checks
   `deals.ownerEmail === user.email` only. `dealParties` exists in the
   schema for counterparties but is never consulted — a legitimate
   counterparty or assigned verification analyst has no path to view deal
   documents. Needs a proper deal-participant/role-based ACL, not just
   single-owner check, once multi-party deal rooms are real.
6. **No structured/security headers** — no CSP, no `X-Frame-Options`, no
   `Referrer-Policy` set anywhere (only the one `x-content-type-options:
   nosniff` on the file-download response). No `middleware.ts` exists in
   this repo at all.
7. **No malware scanning** on uploaded documents — magic-byte + MIME +
   size validation exists (genuinely good), but nothing scans content; the
   mission asks for an integration *point*, which doesn't exist yet either.
8. **No idempotency keys** on deal creation, dispute creation, or match
   interest — a retried POST creates a duplicate deal/dispute record (each
   with its own generated reference).
9. **Errors are generally safe** (routes catch and return generic messages
   rather than leaking stack traces), which is good practice already
   present and worth preserving.

---

## 6. Authentication dependencies

Everything in `app/chatgpt-auth.ts` and every call site
(`getChatGPTUser`, `requireChatGPTUser`, `chatGPTSignInPath`,
`chatGPTSignOutPath`) depends on:
- The `oai-authenticated-user-email` / `-full-name` / `-full-name-encoding`
  request headers being injected by OpenAI's "Dispatch" reverse proxy.
- The reserved routes `/signin-with-chatgpt`, `/signout-with-chatgpt`,
  `/callback` being served by that same external infrastructure — none of
  which exist in this repo or will exist on a Cloudflare Workers deployment.

Call sites depending on this (all need to move to the new auth system):
`app/dashboard/page.tsx`, `app/deal/[id]/page.tsx`, all `app/api/*/route.ts`
files that call `getChatGPTUser()` (deals, disputes, marketplace,
market-requests [optional], notifications, admin/desk, deals/documents ×2),
and every page's sign-out link
(`app/dashboard/page.tsx`, referencing `chatGPTSignOutPath`).
Client pages also hard-link to `/signin-with-chatgpt` directly on a 401
(`app/marketplace/page.tsx`, `app/notifications/page.tsx`), and
`app/disputes/page.tsx` links to a third, different, also-nonexistent path
(`/api/auth/signin?callbackUrl=...`) — an inconsistency worth noting on its
own: the app already disagrees with itself about what the sign-in path is.

---

## 7. Database and storage dependencies

- **D1**: accessed only through `env.DB` (`db/index.ts`), no direct
  `wrangler.toml`/`wrangler.jsonc` binding declaration anywhere in the repo
  — the binding name and existence are currently sourced from the
  nonexistent `.openai/hosting.json`. Schema is Drizzle-first
  (`db/schema.ts`), 4 migrations already generated
  (`drizzle/0000`–`0003`), dialect `sqlite` (correct for D1).
- **R2**: accessed only through `env.BUCKET` inside one route file
  (`app/api/deals/[id]/documents/route.ts`), typed inline as
  `{ put, get, delete }` rather than via a shared `Env` type — no
  `wrangler.toml` binding declaration exists either. Object keys are
  namespaced `deals/{dealId}/{documentId}/{uuid}`, no public bucket access
  is used, downloads are proxied through the Worker — this part of the
  design is already sound and Cloudflare-idiomatic; it just needs a real
  binding declaration.
- No Queues, KV, or other bindings are referenced anywhere in the code.

---

## 8. Missing tests

Current state: **one** test file
(`tests/rendered-html.test.mjs`), asserting the built HTML contains a
Sites-preview meta tag. It is a deployment smoke check, not a product test.
There is:
- No unit test for the landed-cost math (duplicated, slightly differently,
  in `app/page.tsx`, `app/opportunities/page.tsx`, and
  `app/deal/[id]/page.tsx` — three separate inline formulas, not a shared
  function, which is itself a maintainability problem worth fixing when the
  landed-cost engine is built).
- No schema/migration test.
- No API integration test for any route (deals, disputes, marketplace,
  admin, documents).
- No authorization test (nothing proves a non-owner can't read another
  user's deal, or that a non-admin can't hit `/api/admin/desk`).
- No matching-engine test for `app/api/marketplace/route.ts`'s `score()`.
- No upload-security test (magic-byte rejection, oversize rejection, MIME
  mismatch).
- No end-to-end test.
- No accessibility check.
- **The `cloudflare:` module import issue named in the brief**: `db/index.ts`
  and both document route files import from `cloudflare:workers` — a
  Workers-runtime-only module scheme. `node --test` (the current test
  runner, invoked directly, no Miniflare/workerd shim) cannot resolve
  `cloudflare:workers` outside a Worker/Miniflare context. Today this is
  masked because the only test doesn't touch those modules — but any new
  API-route test that imports code touching `getDb()` will hit this
  immediately unless tests run inside `vitest-pool-workers` (or an
  equivalent Miniflare-backed runner) rather than plain `node --test`. This
  is a real, confirmed blocker for the "repair the failing `cloudflare:`
  test" instruction, and the fix is a test-runner change (adopt
  `@cloudflare/vitest-pool-workers`), not a code change to `db/index.ts`.

---

## 9. Cloudflare deployment blockers

In priority order:

1. **`.openai/hosting.json` does not exist.** `vite.config.ts` imports it
   unconditionally. Nothing builds until this import is replaced with a
   real `wrangler.toml`/`wrangler.jsonc` (with explicit `d1_databases` and
   `r2_buckets` blocks, binding names `DB` and `BUCKET` as required) and
   `vite.config.ts` stops depending on Sites-specific hosting metadata.
2. **No `wrangler.toml`/`wrangler.jsonc` exists at all.** D1/R2 bindings,
   compatibility date, and static-asset config currently only exist
   implicitly via the missing hosting.json and the Vite plugin's
   `localBindingConfig`. Production deploy needs an explicit, committed
   Wrangler config with a real (non-placeholder) `database_id` sourced from
   an actual `wrangler d1 create`.
3. **Authentication cannot function outside OpenAI Sites** (§6) — this
   blocks every "requires sign-in" page/route from working at all on
   Cloudflare, not just from being insecure.
4. **The Sites lifecycle scripts assume the Sites builder environment.**
   `scripts/install-ci.sh`/`build-verified.sh`/`sites-env.sh` hardcode
   Sites-specific behavior (single non-retrying `npm ci`, project-local
   `HOME`/npm cache, bounded `timeout` wrapping `vinext build` specifically).
   These need to become (or be replaced by) plain `npm ci` / `npm run build`
   /`wrangler deploy` steps callable from GitHub Actions.
5. **No GitHub Actions workflow exists** (`.github/workflows/` is absent) —
   nothing currently runs lint/typecheck/tests/build on push or PR, and
   nothing deploys.
6. **Placeholder D1 database ID** in `vite.config.ts`
   (`SITE_CREATOR_PLACEHOLDER_DATABASE_ID = "00000000-0000-4000-8000-000000000000"`)
   is a local-dev simulation value only — fine for local Miniflare, but a
   reminder that no real D1 database has been provisioned for this project
   under a real Cloudflare account yet.
7. **`npm test` invokes a full build first** (`"test": "npm run build && ..."`)
   — combined with blocker #1, `npm test` cannot currently pass either.

---

## 10. Recommended implementation sequence

This matches the mission's five-phase delivery sequence; the ordering below
is the concrete first-phase breakdown so nothing is architected twice.

**Phase 1 — Production foundation** (blocks everything else):
1. Add `wrangler.toml`/`wrangler.jsonc` with explicit `DB` (D1) and
   `BUCKET` (R2) bindings, compatibility date, static assets config.
   Provision real (non-placeholder) D1/R2 resources.
2. Remove the `.openai/hosting.json` dependency from `vite.config.ts`;
   source binding config from the new Wrangler file / env instead.
3. Design and implement the replacement auth system (registration, login,
   email verification, session cookies, password reset or passwordless) —
   this is the largest single piece of new code in Phase 1. Replace
   `app/chatgpt-auth.ts` and every call site; remove all
   `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/api/auth/signin`
   references and their inconsistencies (§6).
4. Add `users`, `organizations` (already present, needs wiring),
   `organization_members`, and a real `roles`/`user_roles` model; replace
   the hardcoded `ADMIN` constant with a DB-backed role check enforced
   server-side on every privileged route.
5. Fix the admin match-approval filter bug (§3) while role-checking code is
   already being touched in that file.
6. Adopt `@cloudflare/vitest-pool-workers` (or equivalent) so tests can
   import Worker-runtime code (`cloudflare:workers`) without failing; port
   the existing smoke test and add the first authorization tests.
7. Add `.github/workflows/` for lint + typecheck + test + build, gating
   deploy.
8. Get a real `wrangler deploy --dry-run`/preview deployment green.

**Phase 2 — Functional marketplace:** organization onboarding/profile UI,
wire the unused `quoteRequests`/`quotes`/`introductions` tables to real
routes, replace `official-flow`'s 9-country map with the full 54-country
one already in `lib/africa-countries.ts`, add Turnstile + rate limiting to
public POST endpoints, notifications delivery beyond in-app.

**Phase 3 — Transaction coordination:** extend deal rooms to real multi-
party participants using `dealParties` (fixing the owner-only document ACL
in §5 as part of this), versioned landed-cost calculations (dedupe the
three inline formulas into one shared, tested module), verification-case
evidence workflow beyond the single-admin status flip, retention/legal-hold
handling already partially modeled (`documentFiles.retentionUntil`/
`legalHold`) but unused by any route yet.

**Phase 4 — Intelligence platform:** turn `import-intelligence` and
`official-flow` from request-time-only fetches into a persisted,
source-attributed pipeline (a `source_records` table per the mission's data
model, populated by a Cron Trigger, cached and served from D1 rather than
fetched live on every page load); replace the hardcoded `opportunities`
and `lanes` datasets with a real ranking computed from that pipeline plus
verified buyer/supplier listings — this is the fix for the biggest gap
found in this audit (§3).

**Phase 5 — Production readiness:** French localization (introduce a
translation-key system before Phase 2's UI grows further, ideally), the
security items in §5 (CSP/headers, CSRF, idempotency keys), accessibility
pass, load testing, observability, backup/recovery documentation, legal
placeholder pages (ToS/privacy/etc. — none currently exist), pilot docs.

---

## What this audit deliberately does not do

No application code was modified to produce this document. No destructive
changes, schema migrations, or dependency changes have been made. This file
is the first commit on `claude/production-tradesafe`; Phase 1 work begins
only after this audit and the sequencing above are reviewed and approved.
