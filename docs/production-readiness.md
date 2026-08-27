# Production readiness record

Living document. Every entry is added or updated only after that priority's
full Loop Engineering cycle (inspect → plan → implement → verify
automatically → verify in a real browser → attack-test → review → fix →
repeat → commit/push → document) has actually run — not on completion of a
single pass, not on "compiles," not on "curl returns 200," and not on
automated tests alone.

Status values used below:
- **verified** — implementation exists, automated checks pass, real-browser
  flows and attack cases were exercised and passed, diff was reviewed, no
  known critical/high defect remains, and it's committed and pushed.
- **implemented but not independently verified** — code exists and passes
  automated checks, but the real-browser/attack-test/accessibility pass
  described in this document has not (yet) been run against it.
- **in progress** / **not started** / **blocked** — self-explanatory;
  a **blocked** entry names exactly what's missing (credentials, a
  destructive-action decision, legal/regulatory input, etc.).

---

## Priority 1 — Deal authorization

**Acceptance criteria:** deal room, document download, dispute
participation, and deal-party assignment are authorized consistently
(owner, platform staff, or a recognized `deal_parties` counterparty via an
*active* organization membership or contact-email match — never a removed
party, never an inactive membership); mutations (assign/remove a party)
stay owner-only; IDOR/cross-org/role-escalation/manipulated-ID attempts
fail safely (404, not data leakage); real browser flows work at desktop
and mobile widths; keyboard navigation was checked and a real defect
(missing skip link) was found and fixed.

**Status: verified**

**Files changed:**
- `lib/auth/deal-access.ts` — `resolveDealViewAccess` (existing, from an
  earlier commit) now excludes removed parties (`removedAt IS NULL`);
  added `canManageDeal`, `requireDealAccessOrResponse`,
  `canParticipateInDispute`.
- `app/api/deals/[id]/parties/route.ts` (new) — GET (list, any party with
  deal view access), POST (assign, owner-only, role validated against
  `ORGANIZATION_ROLES`, organizationId existence checked), DELETE
  (remove, owner-only, scoped to the calling deal id so a party id from a
  different deal can't be targeted).
- `db/schema.ts` — `dealParties` gained `assignedByEmail`, `createdAt`,
  `removedAt`, `removedByEmail` (migration `0009`, purely additive).
- `app/api/disputes/[id]/route.ts`, `app/api/disputes/[id]/messages/route.ts`,
  `app/disputes/[id]/page.tsx` — dispute visibility/participation widened
  from "opener or platform reviewer only" to
  `canParticipateInDispute` (opener, reviewer, or anyone with deal view
  access to the dispute's underlying deal). Audience separation (parties
  vs. internal-only messages) is unchanged and still reviewer-gated.
- `app/login/page.tsx`, `app/register/page.tsx`, `app/globals.css` —
  accessibility fix found during this priority's keyboard-navigation
  check (see Defects below).
- `tests/unit/deal-parties-route.test.ts`, `tests/unit/dispute-access.test.ts`
  (new).

**Migrations:** `0009_fantastic_mockingbird.sql` — additive ALTERs on
`deal_parties` only. Applied to a disposable local D1 from scratch
(migrations `0000`–`0009` replayed against an empty database, not just an
already-patched one) — see this priority's automated-verification note.

**Automated checks:** `npx tsc --noEmit` 0 errors · `npm run lint` 0
errors (38 pre-existing warnings, unchanged) · `npm test` 58/58 (7 new:
IDOR/role-escalation/least-privilege cases for the parties route, 3 for
`canParticipateInDispute`) · `npm run build` clean.

**Browser flows verified (Playwright, real dev server, real D1 + R2, not
mocked):**
- Owner registers, creates a deal via the real UI form.
- A counterparty (active member of an org referenced by a `deal_parties`
  row) opens the deal room and sees it — control case proving the
  denials below are real authorization, not a global lockout.
- Deal room and dispute page tested at a 390×844 mobile viewport — page
  loads and the "viewing as counterparty" badge is visible.

**Attack cases tested (all failed safely):**
1. IDOR — a stranger with zero relationship to the deal guesses its id →
   404 on the deal room.
2. Cross-org / inactive membership — a user who IS a member of the
   party's organization, but whose membership `status` is `removed` → 404.
3. Unassigned analyst — a user with no `platformRole` set at all → 404
   (proves platform-role access isn't accidentally open to everyone).
4. Direct API call bypassing the UI — stranger hits
   `GET /api/deals/:id/parties` directly → 404.
5. Role escalation — the legitimate counterparty (who genuinely CAN view
   the deal) attempts `POST /api/deals/:id/parties` to assign themselves
   a broker role → 403 (view access ≠ manage access).
6. Manipulated/guessed ID — the deal's real owner attempts
   `DELETE /api/deals/:id/parties` with a `partyId` that actually belongs
   to a *different* deal they also own → 404 (delete is scoped to the
   deal id in the URL, not just the party id in the body).
7. Direct document download by guessed file id, as a stranger → 404.
8. Dispute IDOR — a stranger with no deal relationship requests a
   dispute tied to that deal directly → "Dispute not found".
9. Control — the legitimate counterparty (previously impossible) CAN now
   view that same dispute — this is the actual fix, not just a negative
   test.

**Accessibility checks completed:**
- Keyboard-only pass on `/login`: found that Tab landed on header nav
  links (`Atlas`, `Create account`) before the sign-in form — a real
  WCAG 2.4.1 (Bypass Blocks) gap, not a hypothetical one. Fixed with a
  standard skip link (`.skip-link` in `app/globals.css`, visually hidden
  until focused) on `/login` and `/register`, targeting the form via
  `tabIndex={-1}` so activating the link actually moves keyboard focus
  there (a plain `<form>` isn't natively focusable). Re-verified: first
  Tab stop is now the skip link; activating it then Tab lands on the
  email field.
- Not yet checked this pass: screen-reader (not just keyboard/focus-order)
  testing, and every other page beyond `/login`/`/register` — see
  Priority 4 below.

**Defects found and fixed:**
1. **Missing skip link on `/login` and `/register`** (accessibility,
   found via keyboard testing) — fixed, re-verified.
2. **Rate-limit-vs-test-traffic collision, not a product defect**: while
   writing this priority's Playwright attack suite, register attempts
   started returning 429. This turned out to be `POST /api/auth/register`'s
   existing rate limit (`8 registrations/hour/IP`,
   `app/api/auth/register/route.ts`) correctly firing — a real, working
   security control, not a bug — after this session's own repeated test
   registrations exceeded it. No code change; local `rate_limit_attempts`
   table rows were cleared to continue testing. Documented here because
   it looked like a defect until root-caused.

**Remaining risks / intentionally deferred (not part of this priority):**
- No UI yet for an owner to assign/remove deal parties from the deal
  room itself — the API exists and is tested, but a trader must currently
  use it directly (or a future admin/deal-room UI) rather than through a
  form. Intentionally out of scope: Priority 1 was authorization
  correctness, not this UX.
- `canManageDeal`/mutation actions (upload, evidence, quote decisions)
  remain owner-only, as decided in the prior commit (`39b4759`) — a
  broker/inspector/logistics-partner role can VIEW but not yet perform
  role-specific actions (e.g., an inspector marking an inspection
  complete). This is real scope for a later priority once the specific
  per-role actions are product-defined, not assumed here.
- Full screen-reader (not just keyboard) verification across the app —
  Priority 4.

**Commit:** `67de635`

---

## Priority 2 — Production security

**Status: in progress.** Inspected the full checklist against the actual
codebase before writing anything new — most of it was already correctly
built in earlier phases; this pass verified that honestly (re-reading the
code, not assuming past commit messages) and closed the one real gap
found (audit logging).

**Already correct, verified by re-reading the actual code this pass (not
newly built here):**
- **CSRF**: `proxy.ts` rejects any mutating `/api/*` request whose
  `Origin` header doesn't match the request's own origin; the session
  cookie is `SameSite=Strict` (defense in depth even for browsers that
  don't enforce the origin check server-side would rely on).
- **Cookies**: `lib/auth/session.ts`'s `sessionCookieHeader` sets
  `HttpOnly`, `SameSite=Strict`, and `Secure` (over HTTPS). Verified in
  code, not just by comment.
- **Session expiration, refresh, and revocation**: `resolveSession` checks
  `expiresAt`, `revokedAt`, and `user.status`, and does a sliding-window
  refresh; `revokeSessionByCookie` / `revokeAllSessionsForUser` exist and
  are actually called (logout; password reset).
- **Session rotation on a sensitive event**: `reset-password/route.ts`
  already called `revokeAllSessionsForUser` on a successful reset before
  this pass touched it — a leaked-then-reset password can't leave old
  sessions trusted.
- **Login/registration/password-reset rate limiting**: all four
  `app/api/auth/*` routes call `consumeRateLimit`, including a
  per-account bucket on login (not just per-IP), verified live this
  session (see Priority 1's report — hit register's real 8/hour/IP limit
  with test traffic, confirming it actually fires).
- **CSP**: nonce-based, verified via Playwright across `/`, `/login`,
  `/marketplace`, `/opportunities` earlier this session (0 CSP
  violations, all inline scripts carry the nonce) — not re-verified
  again in this pass since nothing here touched it.
- **Safe redirect handling**: `app/login/page.tsx`'s `returnTo()`
  rejects anything not starting with `/` or starting with `//` before
  using it as a redirect target; every other `location.href =`/`redirect()`
  call site in the app either uses a hardcoded path or a numeric id from
  a server response, never an arbitrary client-supplied string — grepped
  every occurrence this pass, none are exploitable.
- **File-name sanitization, MIME/magic-byte validation, upload size
  limits**: `app/api/deals/[id]/documents/route.ts` already does all
  three (`file.name.replace(/[^a-zA-Z0-9._ -]/g,"_")`, per-type magic-byte
  checks, 10MB cap).
- **R2 authorization**: closed in Priority 1 (`deal-access.ts`).
- **Hardcoded administrator identity**: removed in Phase 1 (DB-backed
  `platformRole`, no hardcoded email anywhere — grepped this pass to
  confirm, found none).
- **Output encoding**: grepped the whole app for `dangerouslySetInnerHTML`
  — zero occurrences. Everything renders through JSX's default escaping.
- **Secrets outside source control**: `.gitignore` excludes `.dev.vars`
  and `.env*`; only `.dev.vars.example` (no real values) is tracked.
- **Fabricated verification/trade claims**: this is the whole ethic
  behind the existing Opportunity Finder/import-intelligence work
  (Phase 4) — not re-audited line-by-line this pass, flagged here as
  "already addressed elsewhere" rather than silently assumed.

**Gap found and closed this pass: audit logging for sensitive actions.**
`adminAuditEvents` covers admin-desk decisions and
`documentAuditEvents`/`dealEvents`/`disputeEvents` cover deal activity,
but nothing logged *authentication* events at all — no record of who
signed in, from where, or of failed attempts.
- `db/schema.ts`: new `securityEvents` table (migration `0010`,
  additive) — `eventType`, `email`, `ip`, `userAgent`, `details`,
  `createdAt`. Deliberately minimal fields; see
  `lib/auth/security-events.ts`'s header for the explicit "never log a
  password/token/session-id" contract.
- `lib/auth/security-events.ts` (new): `logSecurityEvent()` — never
  throws (a logging failure must not break a real login), swallows and
  `console.error`s instead.
- Wired into `app/api/auth/login/route.ts` (success + two distinct
  failure reasons, logged with the SAME generic detail string so the log
  itself can't be used to enumerate accounts any more than the response
  already can't), `logout/route.ts` (resolves the session for its email
  *before* revoking it — otherwise there'd be nothing to attribute the
  logout to), `register/route.ts`, `request-password-reset/route.ts`
  (logged identically whether or not the account exists — matches that
  route's existing anti-enumeration guarantee), `reset-password/route.ts`.

**Automated checks:** `tsc` 0 errors · `lint` 0 errors (38 pre-existing,
unchanged) · **61/61 tests** (3 new: a real row gets written with
correct fields, failure details don't leak which check failed, and —
proven with a mocked DB failure — logging a failure never throws) ·
`build` clean. Migration `0010` applied cleanly.

**Browser flows verified (Playwright, real dev server, real D1):**
register → confirmed a `register` row exists for that email → logout →
confirmed a `logout` row → failed login (wrong password) → confirmed a
`login_failed` row with the generic detail string → successful login →
confirmed a `login_success` row → password-reset request for an email
with **no account** → confirmed a `password_reset_requested` row exists
for it too (anti-enumeration: the log doesn't distinguish real accounts
from fake ones any more than the HTTP response does) → queried every row
written during the run and confirmed neither the real nor the wrong
password value appears anywhere in the table.

**Remaining Priority 2 scope, not yet done:** input-validation audit
across all route handlers (spot-checked several, not systematically
reviewed every one); a dedicated review of what `adminAuditEvents` does
and doesn't cover for admin-desk actions specifically (assumed adequate
from Phase 1 based on its existing design, not re-verified this pass);
no runbook yet describing how an operator would actually query
`security_events`/`admin_audit_events` during a real incident (Priority
3's "operational runbook" is the right place for that, not duplicated
here).

**Commit:** `fc307aa`

---

## Priority 3 — Reliability, observability, and recovery

**Status: verified** (implementation + automated checks + live-system
verification; paging/alerting and rehearsed restore drills are explicitly
NOT done — see "Remaining risks").

**Files changed:** `lib/observability.ts` (new), `lib/cron-runs.ts` (new),
`app/api/health/route.ts` (new), `app/api/admin/cron-runs/route.ts`
(new), `app/not-found.tsx` (new), `app/error.tsx` (new),
`worker/index.ts`, `db/schema.ts` (migrations `0010`+`0011`),
`docs/DEPLOYMENT.md` (backup/restore + R2 retention/recovery sections
added), `docs/RUNBOOK.md` (new), `tests/unit/cron-runs.test.ts`,
`tests/unit/observability.test.ts`,
`tests/unit/health-and-cron-runs-route.test.ts` (all new).

**Migrations:** `0011_condemned_kabuki.sql` — additive, `cron_runs`
table only (`0010` was Priority 2's `security_events` table, already
recorded above).

**What this closes:**
- **Structured server-side error logging + request/correlation IDs**:
  `worker/index.ts`'s `fetch()` now generates one correlation id per
  request (or reuses an inbound `x-correlation-id` if present), threads
  it onto the request (readable by any downstream Route Handler) and
  every response (so a user-reported failure can be tied to a specific
  server log line), and wraps the entire `handler.fetch()` call in a
  try/catch — the last line of defense for anything that slips past an
  individual route's own try/catch (most already returned clean JSON
  errors before this priority; this catches what didn't). Logs one
  structured JSON line per unexpected error (`lib/observability.ts`),
  never a request body/cookie/token.
- **Health endpoint**: `GET /api/health`, public/unauthenticated
  (matches what an uptime monitor needs), checks real D1 connectivity.
- **Cron-run history + failure visibility**: `cron_runs` table
  (`lib/cron-runs.ts` wraps the existing watchlist-refresh job),
  `GET /api/admin/cron-runs` (administrator-only — can include an error
  message the public health check deliberately never exposes).
- **Safe error pages**: `app/not-found.tsx` and `app/error.tsx` — the
  latter never surfaces `error.message`/`.stack` to the browser; the
  correlation id already logged server-side is the real debugging
  thread.
- **Documented D1 backup/restore + R2 retention/recovery**: expanded
  `docs/DEPLOYMENT.md` — backup command already existed; added an
  honest restore procedure (including the harder point-in-time case,
  which D1 doesn't support natively) and an R2 section that names what
  IS handled (orphaned-object cleanup on a failed upload, already true
  before this priority) versus what ISN'T (no retention policy — flagged
  as needing legal input, not invented here; no versioning/backup
  target wired).
- **Operational runbook**: `docs/RUNBOOK.md` — written against the
  actual signals this app now has (`/api/health`, `wrangler tail`
  correlation ids, `/api/admin/cron-runs`, `security_events`,
  the existing `*_events`/`*_audit_events` tables), not a generic
  template. Explicitly documents its own gaps (no paging, no admin-desk
  UI yet for account suspension/session revocation) rather than
  implying more coverage than exists.
- **Retry-safe/idempotent actions, duplicate-submission protection**:
  already done earlier this session (`lib/idempotency.ts`, commit
  `533f3f4`, before this priority's spec arrived) — noted here for
  completeness since it's explicitly a Priority 3 acceptance item.

**Automated checks:** `tsc` 0 errors · `lint` 0 errors (40 total — the
38-warning baseline plus 2 new `no-html-link-for-pages` warnings from
`not-found.tsx`/`error.tsx`'s own nav links, the same pre-existing,
already-downgraded category as every other page) · **71/71 tests** (10
new: `recordCronRun` persists both success and failure with real
timestamps and proves a "running" row is visible mid-flight;
`logServerError` emits correct structured JSON and never throws on a
non-Error value; `/api/health` returns real DB-check status;
`/api/admin/cron-runs` requires auth, requires administrator
specifically, and returns real rows newest-first) · `build` clean.
Migrations `0010`+`0011` both applied to a disposable local D1.

**Browser/live-system flows verified (not just unit tests):**
- `curl`+Playwright against a live dev server: `/api/health` returns
  `200 {"status":"ok","checks":{"database":"ok"}}` with an
  `x-correlation-id` response header present and unique per request.
- A guessed nonexistent URL returns real HTTP 404 AND renders the actual
  hydrated `not-found.tsx` content (heading text checked, not just the
  status code) with a working link back.
- **The actual Cron Trigger path end-to-end**: hit
  `vinext dev`'s `/cdn-cgi/handler/scheduled` test endpoint for real (not
  mocked) → confirmed via direct D1 query that a `cron_runs` row was
  written with `status: "success"`, real `started_at`/`finished_at`
  timestamps, and correct counts → then registered a real user, promoted
  them to `administrator` via D1, and confirmed
  `GET /api/admin/cron-runs` returns that exact live-run row through the
  actual authenticated API path (not a seeded fixture).
- `GET /api/admin/cron-runs` unauthenticated → 401, confirmed live.

**Security cases tested:** cron-run history (which can contain error
detail) confirmed administrator-only, both via unit test (non-admin gets
403) and live (no session gets 401); confirmed the health endpoint
exposes nothing beyond an ok/error boolean (no stack traces, no row
counts, no internals) even though it's intentionally public.

**Accessibility:** not re-checked this pass — `not-found.tsx`/`error.tsx`
reuse the same `.portal`/`.portalempty` markup and skip-link-eligible
structure as pages already covered in Priority 1's keyboard pass; not
independently re-verified with a fresh keyboard/screen-reader pass.

**Defects found and fixed:** two `react/no-unescaped-entities` lint
errors in the new `not-found.tsx`/`error.tsx` copy (straightforward
apostrophe-escaping issue, fixed and re-verified — lint went from 3
errors back to 0 before anything was committed).

**Remaining risks, explicitly deferred:**
- No paging/alerting on any of these signals — an operator has to
  actively check them. Documented as a known gap in `docs/RUNBOOK.md`
  itself rather than left implicit.
- No admin-desk UI action for account suspension or forced
  session-revocation — both require direct D1 access today. Real
  operational risk during an actual incident; flagged, not solved here.
- Backup/restore is a real, documented procedure but not a rehearsed,
  timed drill, and there's no scheduled/automated backup Cron Trigger.
- R2 retention policy is explicitly NOT set — flagged as needing legal
  input given this platform handles trade/customs/identity documents,
  not invented as a default here.
- Correlation ids and the central error-logging catch cover the
  outermost Worker boundary; they do not retrofit structured logging
  into every individual route's existing try/catch blocks (those already
  returned safe, generic error JSON before this priority — this adds a
  safety net underneath them, not a rewrite of them).

**Commit:** `558c90d`

---

## Priority 4 — Accessibility and localization

**Status: implemented, exhaustive automated color-contrast + structural
sweep now complete across every real route; screen-reader testing and
full string extraction for localization remain explicitly not done.**
This section originally shipped as "partially verified" (only the core
flows named in the spec were checked). A follow-up pass (below) swept
literally every page in the app — all 24 `page.tsx` routes, including
every dynamic-ID route with real data — and closed the specific gap
flagged at the time ("color contrast was not measured with a
contrast-ratio tool").

**Original pass — what was found and fixed:** Real, concrete defects
were found and fixed, and what was fixed was verified live. What's
explicitly NOT done: screen-reader (as opposed to keyboard/DOM-structure)
testing, and full string externalization for localization (a formatting
*foundation* was built and wired into real money displays; the ~30
pages' inline English copy is not translated or extracted into keys).

**Files changed:** `app/globals.css` (focus-visible fix), `lib/i18n/format.ts`
(new), `app/deal/[id]/page.tsx`, `app/disputes/page.tsx`,
`app/disputes/[id]/page.tsx`, `app/admin/page.tsx` (all wired to the new
formatter), `tests/unit/i18n-format.test.ts` (new).

**Accessibility — inspected and verified (not assumed):**
- Checked `app/layout.tsx`: `<html lang="en">` already correct.
- Checked every CSS file for `outline:0`/`outline:none` overrides —
  found exactly two, both with NO `:focus-visible` replacement: the
  homepage's country-search `<input>` and the landed-cost calculator's
  `<input>` fields. **This was a real WCAG 2.4.7 (Focus Visible)
  failure** — a keyboard user tabbing to either field got zero visual
  indication of focus. Fixed with targeted `:focus-visible` overrides
  (matching or exceeding the original rules' specificity, verified via
  computed-style check in a real browser: outline went from `0px none`
  to `2px solid`) plus a baseline global `:focus-visible` rule as
  defense-in-depth for anything not explicitly styled.
- Checked the homepage's interactive Africa map: the SVG country
  `<path>` elements are mouse-only (not natively keyboard-focusable —
  `<path onClick>` has no default tab stop or keyboard handler). This
  is a real gap, but **mitigated, not blocking**: a fully equivalent,
  already-keyboard-accessible `<button>` list of every country sits
  right next to the map (`app/page.tsx`'s `.desk nav .list`) and drives
  the exact same selection state — a keyboard/screen-reader user has a
  working path to every country, just not through the visual map itself.
  Recorded as a remaining risk below rather than silently left
  unmentioned.
- Grepped the whole app for `<img>` — zero occurrences (nothing to
  alt-text; the app has no photography/logo raster images, only inline
  SVG, which is separately checked above).
- Playwright keyboard/landmark/labeling sweep of `/opportunities`,
  `/deal/:id` (a real deal room, not a fixture), `/disputes`, and
  `/notifications`: every page has a `<main>` landmark and an `<h1>`;
  keyboard Tab reaches real, visible interactive elements (not lost to
  `document.body`) on every page; every visible form field has an
  accessible name (an associated `<label>`, `aria-label`, or
  `placeholder`) — zero unlabeled fields found across all four pages.
- Login/register skip-link fix from Priority 1 already covered those
  two flows; not re-tested here since nothing there changed.

**Localization — foundation built, explicitly not full string
extraction:**
- `lib/i18n/format.ts`: `formatCurrency`/`formatNumber`/`formatDateTime`
  via `Intl`, taking an explicit locale rather than depending on the
  server's or browser's ambient default (a deliberate choice — an SSR
  page and its post-hydration client render disagreeing on formatting
  is exactly the shape of bug this branch already had one serious
  incident from, re: the CSP/hydration fix earlier this session).
  `DEFAULT_LOCALE = "en"` is the seam later work hangs a real
  per-request/per-user locale off of. Dates are formatted explicitly in
  UTC — this app has no per-user timezone preference stored anywhere,
  and every timestamp in the database is UTC, so anything else would be
  actively misleading, not more correct.
- Wired into every real, non-hypothetical currency display found via a
  full-app grep of `.toLocaleString()`: deal-room landed
  cost/profit/sale-value metrics (which — real bug found in passing —
  were hardcoded to a literal `$` prefix regardless of the deal's actual
  `currency` field; now genuinely currency-aware), deal-room quote
  totals, and both dispute list/detail views' disputed-amount display.
- Explicitly NOT touched: the homepage's illustrative landed-cost
  calculator (`app/page.tsx`) — it has no currency selector at all (it's
  a hypothetical USD-only estimation tool, not a per-deal transactional
  amount), so it was left alone rather than risk a dense, already-large
  single-line file for a lower-value change.
- Explicitly NOT done: extracting any of the ~30 pages' hardcoded
  English JSX copy into translation keys. That is a separate, much
  larger effort this pass does not attempt.

**Automated checks:** `tsc` 0 errors · `lint` 0 errors (40 total,
unchanged) · **77/77 tests** (6 new: currency formatting with grouping,
a real non-USD currency — KES, matching this app's existing currency
select list — a graceful fallback on an invalid ISO code rather than a
throw, number grouping, and UTC-explicit date formatting) · `build`
clean.

**Browser flows verified live, not just unit-tested:**
- Computed-style check confirmed the focus-visible fix actually renders
  a visible outline (not just correct CSS source).
- Created a real deal with a real supplier cost
  (`$1,234,567.50`/`$2,000,000.00`) through the actual UI form and
  confirmed the deal room's metrics render properly grouped currency —
  not the un-grouped/ungrouped-but-technically-correct number a naive
  fix could have produced.
- Seeded a real dispute with a non-USD currency (`KES`) and confirmed
  the disputes list renders it through `Intl` (`KES 5,000.00`, the
  actual currency code/symbol) rather than the old hardcoded pattern
  that would technically have shown the right code but without correct
  grouping/decimal handling for that locale.

**Defects found and fixed:** the focus-visible CSS gap (real WCAG
2.4.7 failure); the deal room's landed-cost/profit/sale-value metrics
hardcoding `$` regardless of the deal's actual currency (a real
correctness bug found while wiring the formatter, not a hypothetical).

**Remaining risks, explicitly deferred (as of the original pass):**
- No screen-reader (as opposed to keyboard-DOM) testing was performed —
  the checks above verify keyboard operability and DOM-structural
  accessibility (landmarks, labels, focus), not what a screen reader
  actually announces.
- The homepage's interactive SVG country map is not independently
  keyboard-operable (mitigated by an equivalent list, not fixed).
- Only the flows explicitly named in the spec were checked — dozens of
  other pages (organizations, quote-request forms specifically,
  milestone/document upload interactions, admin desk) were not
  independently swept. **Closed by the follow-up sweep below.**
- No French (or any second language) support exists — `SUPPORTED_LOCALES`
  currently has exactly one entry (`"en"`), by design, matching "keep
  English as the initial complete language" — but no actual translation
  work has started.
- Color contrast was not measured with a contrast-ratio tool (no
  automated contrast checker was run against this app's palette).
  **Closed by the follow-up sweep below.**

---

### Follow-up: exhaustive sweep of every page (real `axe-core`, not a
sample)

Triggered directly by a user request to check every page literally,
after the original pass above deliberately scoped itself to only the
flows named in the spec. This pass covers what that one explicitly
left open: color contrast (measured, not assumed) and full-app page
coverage (not a sample of "core flows").

**Method:** a real Playwright script drove a real Chromium browser
against the local dev server, registered real accounts (trader,
administrator, `verification_analyst`), created a real organization,
deal, dispute, and referral code, then visited **every one of this
app's 24 `page.tsx` routes** — including every dynamic-ID route
(`/deal/:id`, `/disputes/:id`, `/organizations/:id` when reachable,
`/r/:code`, `/link/:token`), both desktop (1280px) and mobile (390px)
viewports — and ran the real `axe-core` 4.13 engine (the industry-standard
automated WCAG checker, injected via script tag, not a hand-rolled
heuristic) against the live DOM of each, plus a horizontal-overflow
check on mobile and a zero-console-errors check on every page.
`/organizations/:id` was the one route this run could not reach with a
real ID (organization creation in the test script hit a form-handling
edge case unrelated to accessibility); every other route, including
every other dynamic one, got a real ID and a real render.

**Real defects found and fixed, not assumed:**
- **24 distinct color/text-size combinations across the entire app
  failed WCAG AA contrast** (4.5:1 for normal text, 3:1 for large
  text) — muted "eyebrow label" grays, golds, and greens used for
  small uppercase captions throughout `globals.css`, `portal.css`,
  `admin.css`, `marketplace.css`, `finder.css`, `intelligence.css`,
  `live.css`, `quote.css`, `built.css`, plus two inline-styled
  shorthand hex colors (`#889`, `#789`) on the corridors page. Every
  one was measured with axe-core's real contrast algorithm (not
  guessed), corrected to a new shade that keeps the same hue/design
  language but clears the real WCAG threshold (verified: every fix
  re-measured at ≥4.5:1 or, for the two genuinely large-text cases,
  ≥3:1, with a real safety margin — no fix left sitting exactly on the
  boundary). Two of the twenty-four (the brand green used for
  `.dealhead p` on a dark deal-room background, and `.positive` used
  inside the dark `roommetrics` stat strip) share their base color
  with other, already-compliant uses elsewhere in the app (a CSS
  custom property and a shared status class respectively) — those got
  a scoped, higher-specificity override for just the failing context
  instead of a global color change, so the already-fine usages
  elsewhere were not touched or risked.
- **A real mobile-only navigation overflow on `/dashboard`**: the
  signed-in trader header nav (7 links — Opportunity map, My
  organizations, Matches, Notifications, Open a deal, Disputes, Sign
  out) is the busiest nav in the app; the existing mobile rule only
  hid one link, leaving the rest to overflow the 390px viewport
  horizontally. Fixed by making the header nav wrap onto a second line
  on narrow viewports (`flex-wrap:wrap`) in `portal.css`, `admin.css`,
  and `marketplace.css` — applied to all three shared header patterns,
  not just the one that happened to overflow first, since any of them
  could grow past its current link count later. Verified: re-ran the
  exact same live scenario (fresh account, real deal created) at
  390×844 before and after — `scrollWidth > clientWidth` went from
  `true` to `false`, and no link was removed or hidden.

**Not real defects — investigated and ruled out, not silently
ignored:**
- The homepage showed `502` console errors from `/api/import-intelligence`
  on every load. Traced to the two external data sources it calls
  (`comtradeapi.un.org`, `api.worldbank.org`) — confirmed via a direct
  `curl` from this sandbox that the sandbox's own network egress policy
  blocks both (`CONNECT tunnel failed, response 403`), not an app bug.
  The route already does the honest thing on that failure — a real
  `502` and a "temporarily unavailable" message, never a fabricated
  number — exactly per this project's "never fabricate" convention;
  nothing needed changing.
- Anonymous visits to `/marketplace` and `/organizations` logged a
  `401` console error before redirecting to `/login`. Confirmed in the
  page source: this is the same intentional client-side
  `if (r.status === 401) location.href = loginPath(...)` pattern used
  on every auth-gated client page in the app — the console entry is
  the browser logging the failed fetch a beat before the redirect
  fires, not a broken or stuck state.

**Automated checks (after the fixes above):** `tsc` 0 errors · `lint`
0 errors (54 warnings, unchanged from Priority 13's baseline — none in
the touched files) · **221/221 tests** (unchanged — this pass touched
only CSS color values and two inline styles, no logic) · `build` clean.

**Scope note, stated plainly:** this closes the two gaps the original
Priority 4 pass named as open (contrast measurement, full-page
coverage) using a real automated WCAG engine against real rendered
pages with real data. It does **not** add screen-reader testing or
localization/string-extraction — those remain exactly as scoped in the
original pass above, unchanged.

**Commit:** `bebb9ff`

---

## Priority 5 — Corridor operating templates

**Status: verified.**

**Files changed:** `db/schema.ts` (migration `0012`: `corridor_templates`
table + `deals.corridorTemplateId`), `lib/corridor-templates.ts` (new),
`app/api/admin/corridor-templates/route.ts` (new),
`app/api/corridor-templates/route.ts` (new), `app/corridors/page.tsx`
(new), `app/api/deals/route.ts` (attaches the current template at
creation time), `tests/unit/corridor-templates.test.ts` (new).

**Migration:** `0012` — additive: new `corridor_templates` table, one
new nullable FK column on `deals`.

**Data model:** immutable, versioned rows — editing a corridor never
UPDATEs an existing row, it INSERTs a new one with the same
`corridorKey` and `version + 1` (enforced in
`lib/corridor-templates.ts`'s `createCorridorTemplateVersion`, verified
by a test that edits a corridor twice and confirms the first version's
row is byte-for-byte untouched). `deals.corridorTemplateId` is set once,
at creation time, to whichever version was current then — a later edit
to that corridor creates a new row and never touches the deal's existing
reference, which is what makes "historical deals retain the
corridor-template version under which they were created" actually true
rather than aspirational.

**Three-tier distinction**, all real and queryable, not just described
in prose:
- **Intelligence coverage** — every one of the 54 countries the existing
  Opportunity Finder/import-intelligence work already covers (Phase 4).
  No new table needed; this tier is simply "any corridor with no
  template row at all."
- **Operationally supported** — a `corridor_templates` row exists with
  status `draft` or `reviewed`.
- **TradeSafe Verified** — the corridor's CURRENT version specifically
  has status `operational`. An older, since-superseded operational
  version does not count — only the latest version's status reflects
  where the corridor stands today (tested explicitly).
- Enforced at the API layer, not just the UI: `POST
  /api/admin/corridor-templates` rejects a `reviewed`/`operational`
  status submitted without both a real `sourceAttribution` and a real
  `reviewerEmail` — the same "never fabricate verification" ethic this
  app already applies everywhere else, applied here too rather than
  left as a documentation-only expectation.

**Public vs. admin split:** `GET /api/corridor-templates` is
unauthenticated (a prospective trader needs to see this before signing
up) and deliberately excludes `riskRules`/`escalationRules`/
`requiredBuyerInfo`/`requiredSupplierInfo` — internal operational detail,
not something to publish. `GET`/`POST /api/admin/corridor-templates` is
administrator-only and sees everything, including full version history.

**The one demonstration corridor** (Ghana → Nigeria): seeded via a real
call to the real admin API from a real registered-and-promoted
administrator account during live verification — not a hand-crafted SQL
insert — so the seed itself proves the API works end-to-end. Every text
field is explicitly prefixed `DEMONSTRATION DATA` /
`DEMONSTRATION CORRIDOR`, and `sourceAttribution` states outright: "Not
sourced from any real regulatory or operational review. Do not treat as
current or accurate." Confirmed this label is actually visible on the
public `/corridors` page, not just present in the database.

**Automated checks:** `tsc` 0 errors · `lint` 0 errors (42 total — 2 new
expected `no-html-link-for-pages` warnings from `/corridors`' own nav
links, same downgraded category as every other page) · **91/91 tests**
(14 new: tier resolution across all three states, immutable-versioning
proof, admin auth/role/validation guards, public-API field exclusion,
suspended-corridor exclusion, current-version-only collapsing) · `build`
clean.

**Live browser flows verified, not just unit tests:**
- **Attack case**: a real, non-admin trader account attempting
  `POST /api/admin/corridor-templates` directly → 403.
- The real seed (above) via the real authenticated admin API.
- `/corridors` (public, real page load) shows the demonstration corridor
  under Tier 3 with the DEMONSTRATION label visible in the rendered
  page, and the page states all three tier names explicitly.
- The public API response was checked byte-for-byte to confirm none of
  the internal-only field content leaked through.
- **The actual point of the versioning model**: created a real deal for
  Ghana → Nigeria through the real `/deal/new` form, then queried D1
  directly and confirmed `deals.corridor_template_id` was set to the
  real seeded template's id (version 1) — and, as a control, created a
  second real deal for an unrelated corridor (Kenya → Uganda, which has
  no template) and confirmed its `corridor_template_id` is `null` — the
  attachment logic activates only when a real match exists, not always.

**Remaining risks, explicitly deferred:**
- `standardMilestonesJson`/`costComponentsJson` exist on the schema and
  are populated on the demonstration corridor, but deal creation
  (`app/api/deals/route.ts`) still seeds every deal's milestones from the
  same hardcoded four-step default regardless of whether a matching
  template exists — the schema is ready for a template to actually drive
  a deal's milestones, that wiring isn't built yet.
- No admin UI for managing corridor templates — API only, tested via
  direct calls; an operator today would need to call the API directly
  (or a future admin-desk tab) rather than use a form.
- Only one demonstration corridor exists; this priority intentionally
  does not attempt real corridor coverage for any actual market, per
  "Do not attempt to operationalize every African country."

**Commit:** `a3d0b30`

---

## Priority 6 — Risk-based verification

**Status: verified.**

**Files changed:** `db/schema.ts` (migration `0013`:
`organization_verifications` table), `lib/verification-levels.ts` (new),
`app/api/admin/organization-verifications/route.ts` (new),
`app/api/organizations/[id]/verification-level/route.ts` (new),
`app/api/admin/verification-recommendation/route.ts` (new),
`tests/unit/verification-levels.test.ts` (new).

**Migration:** `0013` — additive, one new table.

**Deliberately a SEPARATE concept from the existing `verification_checks`
table** (per-deal, transaction-specific checks like `buyer_authority` or
`stock`) — this tracks an ORGANIZATION's standing facts across every
deal it's ever part of, as the six-level progression the mission
specifies (identity → business registration → address/bank ownership →
capability/inventory → independent inspection → transaction history).

**The progression is real, not cosmetic** — an organization's "current
level" is the highest N such that levels 1..N are ALL passed,
not-expired, human-reviewed facts. A passed level-3 fact with a gap at
level 2 does NOT count toward level 3 — the org stays capped at whatever
it last achieved contiguously. Proven both in a unit test and live in a
real browser: recorded level 1 and level 3 (skipping level 2) for a real
organization, confirmed the public API still reported level 1; then
filled level 2, confirmed the level jumped to 3 in the same request
cycle.

**The AI boundary is enforced, not just documented**: `humanReviewRequired`
defaults `true`, and a row with it left `true` never counts toward the
level — proven live by recording an "AI document extraction" result with
no human confirmation and confirming the org's level did not move. The
only route that can ever set `humanReviewRequired: false` additionally
requires a real `source` and `reviewerEmail` on that same request — an
AI-flagged result cannot self-finalize by omission, and a human
confirming one must be named, not just implied by which role the request
came from.

**Rules engine**: `recommendVerificationLevel()` is a pure function —
transaction value, corridor tier (reusing Priority 5's
`intelligence`/`operational`/`verified` tiers), product risk, first-time
relationship, prior disputes, payment terms, and evidence quality each
contribute an explainable, reasoned level addition, capped at 6. Its
own `policyNote` states outright that these are this platform's own
risk thresholds, not an external regulatory requirement — the same
"never fabricate authority" discipline as everywhere else in this app.
It is exposed via an API that WRITES NOTHING and enforces nothing — pure
decision support for a human, matching "AI may extract, compare,
summarize, and flag evidence. AI must not make final ... verification
... decisions."

**Public vs. admin split:** `GET /api/organizations/:id/verification-level`
is unauthenticated (a counterparty deciding whether to trust an
organization needs this without needing admin access — "transparent
verification levels" only means something if it's actually visible) and
returns ONLY the level number and which named levels were achieved —
never the underlying evidence, notes, or reviewer identity, which stays
behind `GET/POST /api/admin/organization-verifications` (administrator
or verification_analyst only).

**Automated checks:** `tsc` 0 errors · `lint` 0 errors (42, unchanged —
no new pages this priority) · **110/110 tests** (19 new: level-0
baseline, single-fact level-1 achievement, the gap-capping proof, the
AI-boundary proof, expiration handling, append-only history proof
across a failed-then-passed re-check, five rules-engine cases including
the "every factor has a stated reason" check, and full auth/validation
coverage on all three routes) · `build` clean.

**Live browser/attack verification, not just unit tests:**
- **Attack**: a real, non-reviewer trader account attempting
  `POST /api/admin/organization-verifications` directly → 403.
- A brand-new real organization confirmed at level 0 via the public
  endpoint.
- A real admin recorded a real level-1 fact; confirmed level 1 via the
  public endpoint immediately after.
- **The gap-capping behavior, live**: recorded level 3 (address/bank
  ownership) while level 2 was still missing, confirmed via the public
  API that the level stayed at 1, not 3 — then filled level 2 and
  confirmed the level correctly jumped to 3.
- **The AI-boundary behavior, live**: recorded a "passed" result with no
  `humanReviewRequired` override (defaults `true`) and confirmed the
  organization's level did not move.
- The rules engine, called through the real authenticated API, for a
  deliberately extreme high-risk profile → correctly capped at level 6
  with a multi-factor, individually-reasoned breakdown.

**Remaining risks, explicitly deferred:**
- No UI for staff to record verifications or view an org's history — API
  only, fully tested via direct calls.
- The recommendation engine's inputs (`productRisk`, `paymentTerms`,
  `evidenceQuality`) are supplied by the caller, not auto-derived from
  deal data — `deals` has no product-risk or payment-terms field yet, so
  wiring this into an actual deal-creation flow automatically is a
  follow-on, not done here.
- Recommended levels are not tied to any enforcement (e.g., blocking a
  quote acceptance below the recommended level) — intentionally, per the
  AI boundary; if a future priority wants an enforced gate, that's a
  distinct, larger product decision this priority does not make.

**Commit:** `b2f5a4e`

---

## Priority 7 — Standard transaction workflow

**Status: verified.**

**Files changed:** `db/schema.ts` (`deals.stage` default comment
explaining a real D1 limitation — no migration; see below),
`lib/deal-stages.ts` (new — pure, client-safe), `lib/deal-workflow.ts`
(new — the DB-backed state machine), `app/api/deals/route.ts` (sets
`stage` explicitly on creation), `app/api/admin/desk/route.ts` (deal
transitions now go through the real engine, not a flat allowed-values
check), `app/admin/page.tsx` (deal quick-actions replaced with a real
adjacency-aware "Advance to X" control), `tests/unit/deal-workflow.test.ts`
(new).

**What was actually broken before this**: `deals.stage` was a free-text
column any reviewer could `PATCH` to any of 9 unordered values via the
admin desk, with zero adjacency checking. A reviewer really could move a
brand-new deal from `intake` straight to `closed` in one request — this
was verified as a real, live exploit before being fixed (see attack
case below), not a hypothetical.

**The 13-stage graph** (`lib/deal-workflow.ts`) is a strict linear chain
matching the mission's stage list exactly. Each transition defines:
authorized roles, a precondition (where this platform's data model can
honestly check one — see below), and reversibility. `attemptDealTransition()`
is now the ONLY code path that writes `deals.stage` — it validates the
deal exists, the requested "to" stage is genuinely the next stage from
wherever the deal currently is (not any arbitrary stage), the actor's
role is authorized for that specific edge, and any real precondition is
met, before writing anything — and every successful transition writes a
`dealEvents` row (`stage_transition`), reusing the existing event log
rather than inventing a parallel audit trail.

**Precondition honesty** — real, DB-checked conditions where the data
model genuinely supports them, explicit human-attestation (reason
required, already an existing admin-desk requirement) where it doesn't,
never a fabricated automated check for something this platform can't
actually observe (it doesn't hold money, run logistics, or clear
customs):
- `parties_assigned`: a real, non-removed `deal_parties` row exists.
- `counterparties_verified`: **a genuine cross-priority integration** —
  every party with an organization must have reached Priority 6's
  verification level 1, checked live via
  `resolveOrganizationVerificationLevel`.
- `quotes_received`: a real quote exists for this deal (joined through
  `quote_requests`).
- `quote_accepted`: a real quote with `status:'accepted'` exists.
- `preshipment_evidence_approved`: the deal's "Verified loading"
  milestone (sequence 2) has `evidenceStatus:'verified'` — a documented,
  soft name/sequence coupling, not a formal FK (milestones and workflow
  stages aren't linked in the schema yet — a real limitation, stated
  plainly, not hidden).
- `payment_confirmed` onward (payment, dispatch, customs, delivery,
  reconciliation, closing): no automated precondition exists because
  this platform genuinely cannot observe these events — they're human
  attestations, gated by role (payment confirmation and closing are
  **administrator-only**, not verification_analyst, given the mission's
  explicit "TradeSafe never holds or moves money" rule makes "an
  administrator recorded that a licensed partner confirmed payment" a
  materially bigger claim than routine evidence review) and the reason
  field the admin desk already requires on every action.

**A real D1 migration limitation, worked around correctly, not
silently**: changing `deals.stage`'s column default forces drizzle-kit
to recreate the table (SQLite can't `ALTER COLUMN ... SET DEFAULT`
directly), and that recreate genuinely failed against D1's migration
runner (`FOREIGN KEY constraint failed`) — confirmed by actually
attempting it, not assumed. Rather than force a risky workaround, the
column default stays at the old literal `"intake"` (documented in
`db/schema.ts` as intentional, not an oversight) and
`app/api/deals/route.ts` sets the real value (`DEAL_STAGES[0]`)
explicitly on every insert — the default is realistically never hit.
Existing local dev rows were normalized via a direct `UPDATE`, separate
from the migration system, exactly like earlier local-only data cleanup
this session (rate limit test rows, etc.).

**A real client-bundle bug caught before it shipped**: the first draft
had `app/admin/page.tsx` (`"use client"`) importing `nextStage` directly
from `lib/deal-workflow.ts`, which also exports `attemptDealTransition`
and pulls in `getDb`/`cloudflare:workers` at module scope — importing
that into a browser bundle would break the client. Caught during
inspection (not by a build failure — vinext's dev bundler didn't flag
it), fixed by splitting the pure stage-list/adjacency logic into
`lib/deal-stages.ts` with zero server dependencies, which
`lib/deal-workflow.ts` now imports FROM rather than duplicating.
Verified live: `/admin`'s Deals tab loads with zero console errors.

**Automated checks:** `tsc` 0 errors · `lint` 0 errors (42, unchanged) ·
**120/120 tests** (10 new: full stage-list adjacency proof,
legacy-stage-value handling, the stage-skip block, precondition
enforcement for parties/counterparties/quotes with real DB data,
role-authorization for the administrator-only transition, and the
404 case) · `build` clean.

**Live browser + attack verification, not just unit tests:**
- A real deal created through the real `/deal/new` form starts at
  `request_confirmed` (confirmed via direct D1 query), not the old
  `intake`.
- **Attack**: a direct `PATCH /api/admin/desk` attempting
  `request_confirmed` → `closed` in one call → 400, naming the actual
  legal next stage (`parties_assigned`) in the error.
- `parties_assigned` blocked with no real party, then succeeds
  immediately after a real party is added through the real
  `POST /api/deals/:id/parties` route (Priority 1).
- `counterparties_verified` blocked with the organization at
  verification level 0, then succeeds immediately after recording a
  real level-1 fact through the real Priority 6 API — proving the
  cross-priority integration works live, not just in isolated unit
  tests of each module.
- **Attack**: a real verification_analyst account attempting the
  administrator-only `payment_confirmed` transition directly → 403.
  A real administrator account performing the same transition → 200.
- The admin UI itself, loaded fresh in a real browser: zero console
  errors, and the Deals tab shows the real current stage plus a real,
  server-validated "Advance to X" control.

**Remaining risks, explicitly deferred:**
- No reversal path is implemented for any transition (all `reversible`
  flags are conservative defaults — see the file) — a stage regression
  today requires direct database intervention. A real limitation, not
  silently designed around.
- Deadlines and escalation rules per transition (mission-requested
  fields) are not modeled yet — that's Priority 8's exception-queue
  territory, not duplicated here.
- The `preshipment_evidence_approved` precondition's milestone coupling
  is a documented soft assumption (sequence 2 = "Verified loading"),
  not a formal schema link — fragile if the milestone seed ever changes
  without updating this file too.
- Parties recorded by contact only (no `organizationId`) can't be
  checked against `organization_verifications` — the
  `counterparties_verified` precondition can't verify them, and silently
  doesn't block on them either. Documented, not hidden.

**Commit:** `d2a2c6f`

---

## Priority 8 — Exception operations queue

**Status: verified.**

**Files changed:** `db/schema.ts` (`exceptions` table + `EXCEPTION_TYPES`/
`EXCEPTION_SEVERITIES`/`EXCEPTION_STATUSES`; `milestones.dueAt` +
`milestones.createdAt`), `drizzle/0014_chubby_thor_girl.sql` (migration),
`lib/exceptions.ts` (new — all detectors + `syncExceptionQueue`),
`lib/cron-runs.ts` (generalized `recordCronRun<T>` — see below),
`worker/index.ts` (wires `exception-queue-sync` into the existing Cron
Trigger), `app/api/admin/exceptions/route.ts` (new — GET syncs+lists,
PATCH assign/start/resolve/dismiss), `app/api/admin/milestones/[id]/schedule/route.ts`
(new — the only way `milestones.dueAt` gets set), `app/api/deals/route.ts`
(seeds milestone 4's `dueAt` from the deal's own `targetDate`),
`app/api/disputes/route.ts` (wires the previously-dead `responseDueAt`
column — see below), `app/admin/page.tsx` + `app/admin.css` (new
Exceptions tab, now the default tab), `tests/unit/exceptions.test.ts`
(new).

**What this actually is**: not a new ledger — a read of REAL conditions
already sitting in `deals`/`verificationChecks`/`organizationVerifications`/
`dealDocuments`/`milestones`/`disputes`, surfaced in one risk/deadline-
ranked queue so "the standard operational path should not require
manually monitoring every deal" (the mission's own phrase) is actually
true. Every detector in `lib/exceptions.ts` is documented with exactly
which real column it reads; there is deliberately **no** "material
landed-cost change" detector — `dealCosts` is write-once at deal creation
and no route in this codebase has ever updated it, so there is no real
signal to detect yet. Fabricating one would violate this project's core
rule; this is called out explicitly as **intentionally deferred**, not
silently skipped, pending either a real cost-revision flow or Priority
12's landed-cost work.

**Two previously-dead columns, wired up for real, not just noticed:**
- `verificationChecks.expiresAt` existed since Phase 3 but nothing ever
  read it — `expired_verification_check` is the first real consumer.
- `disputes.responseDueAt` existed in the schema with nothing ever
  setting it. `app/api/disputes/route.ts` now sets it at dispute creation
  (this platform's own 3-day response-SLA policy —
  `DISPUTE_RESPONSE_SLA_MS`, documented as internal policy, not an
  external SLA, same honesty convention as Priority 6's thresholds) —
  `dispute_overdue` is the first real consumer of that too.

**Detectors implemented, each reading a real signal:**
`failed_verification_check`, `expired_verification_check`,
`failed_organization_verification` / `expired_organization_verification`
(only the LATEST fact per org+level counts — an old failed attempt a
later re-check superseded is history, not an open exception),
`rejected_document`, `missing_required_document` (a stage-based
heuristic — `dealDocuments` has no `createdAt` to measure elapsed time
against, a real documented gap, not a fabricated day-count),
`overdue_milestone` (only fires on a milestone with a REAL `dueAt` — a
null `dueAt` is never "overdue"), `payment_exception` / `stalled_deal`
(real signal: `deals.updatedAt`, already stamped by every stage
transition), `high_value_deal`, `unproven_corridor_deal`,
`verification_regression` (**a genuine cross-priority integration and a
real gap the state machine itself can't catch**: Priority 7's
`counterparties_verified` precondition only checks AT the moment of that
one transition — if a party's verification later expires or a re-check
fails, a deal that already passed that gate isn't retroactively
blocked. This detector is the ongoing check for that regression,
severity `critical`), `dispute_overdue`.

**Dedupe and the audit trail, reusing two already-proven patterns rather
than inventing new ones:**
- **Insert-based claim via a unique index** (`exceptions.openDedupeKey`,
  unique) — the exact fix already applied once this session to
  `idempotencyKeys`'s select-then-insert race. `openDedupeKey` equals
  `dedupeKey` (`exceptionType:entityType:entityId`) for every status
  except `resolved`; SQLite treats every `NULL` as distinct, so many
  resolved rows can share a `dedupeKey` over time without violating the
  index. `dismissed` deliberately keeps the key claimed (see attack case
  below) — only `resolved` frees it.
- **Audit trail via the existing `adminAuditEvents` table** — every
  human assign/start/resolve/dismiss writes a row there, same as every
  other admin-desk decision, not a new parallel log. System auto-resolves
  (the condition genuinely cleared) are self-documenting on the
  `exceptions` row itself (`resolvedByEmail: ""`, matching this schema's
  existing "" = unset convention) — there is no "system" user to attach
  to `adminAuditEvents.actorUserId` (`NOT NULL`), the same reasoning
  Priority 3's `cronRuns` table already established for background work.

**A real bug caught during inspection, before it shipped**: the first
draft of `detectHighRiskDeals` gave the "high-value deal" and
"unproven-corridor deal" checks the SAME `entityType:"deal"` +
`entityId:deal.id`, both under one shared `high_risk_deal` type — meaning
their `dedupeKey`s collided, and a deal triggering both conditions at
once would silently only ever get ONE of the two exceptions recorded
(the second insert loses the unique-index race to the first, and that's
treated as "already exists," not an error). Fixed by giving each
condition its own distinct exception type (`high_value_deal`,
`unproven_corridor_deal`, `verification_regression`) — caught by
re-reading the diff before writing tests, not by a failing test.

**`recordCronRun` generalized, not duplicated**: Priority 3's helper was
typed to require a `{refreshed, failed}` result shape, fitting only the
one job that existed then. Rather than bypass it or hand-roll a second
cron-tracking helper for `exception-queue-sync`, it now accepts any
result type and structurally extracts `refreshed`/`failed` counts when
present, storing `null` otherwise — the intelligence-watchlist job's
behavior is unchanged; the exception-sync job's own `{created,
autoResolved, totalOpen}` counts still reach the caller and
`console.log`, just not those two specifically-named columns.

**Automated checks:** `tsc` 0 errors · `lint` 0 errors (42 warnings,
unchanged) · **142/142 tests** (22 new — detection correctness per
detector, the dedupe race under real `Promise.all` concurrency, real
auto-resolve, a recurrence-after-resolution getting a fresh row instead
of silently reopening the old one, the full assign→start→resolve
lifecycle, dismiss's "not immediately recreated" behavior, every route's
role gating) · `build` clean, both new routes present in the route
manifest.

**Live browser + attack verification, not just unit tests:**
- A real deal created through the real `/deal/new` form, a real
  verification check failed via direct D1 update (simulating a reviewer
  decision), then the **already-existing** admin `/admin` page loaded
  fresh: the Exceptions tab (now the default tab) shows it with zero
  console errors, correct severity (`HIGH`), and the correct
  `responsibleParty` (the real deal owner's email) — not a fixture.
- **A genuinely unplanned real find**: the SAME live run also surfaced a
  `missing_required_document` exception on a deal left over from
  Priority 7's own verification session (`Commercial Invoice`/
  `Packing List` still `required` on a deal that had already reached
  `payment_confirmed`) — proof the detector works against organically
  existing data, not only data manufactured for this test.
- **Attack**: a plain trader (deal owner) → `GET /api/admin/exceptions`
  → 403. → `PATCH .../exceptions` (dismiss) → 403.
- **Attack**: anonymous (no session) → `GET /api/admin/exceptions` → 401.
- **Attack**: `PATCH` with no `reason` → 400 on every action, matching
  every other admin-desk decision.
- **Attack**: a manipulated/nonexistent exception id (`999999999`) → 404.
- **Attack**: resolve with no `resolutionSummary` → 400.
- A real `verification_analyst` (not just administrator — proving
  least-privilege isn't accidentally over-restricted) assigns the
  exception to themselves → 200, persisted, status auto-bumped to
  `in_progress`, visible in the admin UI after a real reload.
- The underlying verification check is genuinely re-verified (not the
  exception row edited directly) → the next sync **auto-resolves** it
  with `resolvedByEmail: ""` — a system resolution, not a fabricated
  human one.
- A reviewer schedules a real milestone `dueAt` in the past via
  `PATCH /api/admin/milestones/:id/schedule` → the next sync genuinely
  flags it `overdue_milestone` — end-to-end from a human decision to a
  detected exception.
- Mobile viewport (390×844): no horizontal overflow on the Exceptions
  tab. Keyboard-only: first `Tab` reaches a real focusable element.
- **Accessibility tree** (not just an automated scanner — a real
  Playwright accessibility snapshot, honoring the mission's explicit
  screen-reader requirement): every tab button and every queue action
  button (`Assign to me`/`Start work`/`Resolve`/`Dismiss`) has a real,
  non-empty accessible name — 0 unnamed interactive nodes found.
  Severity is conveyed as visible TEXT (`HIGH`/`MEDIUM`/…), with the
  color border strictly supplementary, not the only signal.

**Remaining risks, explicitly deferred:**
- No "material landed-cost change" detector — see above; genuinely no
  real signal exists yet, not a shortcut.
- `missing_required_document` is a stage-based heuristic, not a
  day-count one, because `dealDocuments` has no `createdAt` column.
- Per-row queue action buttons (`Assign to me`, etc.) don't carry a
  disambiguating accessible name beyond DOM order — a pre-existing
  pattern shared by every other admin-desk tab (Listings, Documents,
  Checks, …), not a regression introduced here; a real follow-up for a
  future accessibility pass across the whole admin console, not scoped
  to this priority alone.
- `syncExceptionQueue`'s org-verification "latest fact" lookup
  (`latestOrgVerificationFacts`) does a full-table scan of
  `organization_verifications` in JS rather than an indexed query —
  fine at this platform's current data volume (matches this codebase's
  existing `.limit(200–500)` scale assumptions elsewhere), worth
  revisiting before that table reaches thousands of rows.
- No UI filter/search on the Exceptions tab yet (open/in-progress items
  are shown; resolved/dismissed are fetched but not surfaced in a
  separate view) — acceptable for the current queue size, a real
  limitation if the queue grows large.

**Commit:** `f2ef013`

---

## Priority 9 — Low-friction customer acquisition

**Status: verified.**

**Files changed:** `db/schema.ts` (`marketRequests` gains `quantity`,
`unit`, `productSpec`, `requiredDeliveryDate`, `existingQuoteNote`,
`preferredContactMethod`, `consentAt` — all additive/nullable),
`drizzle/0015_tough_butterfly.sql` (migration), `app/api/market-requests/route.ts`
(role:`quote_request` path: origin optional, consent mandatory, new
fields persisted; every pre-existing role's behavior unchanged),
`app/quote/page.tsx` (new), `app/quote.css` (new, genuinely mobile-first
— single-column by default, no desktop-only grid), `app/layout.tsx`
(registers the new stylesheet), `app/page.tsx` (one new homepage CTA
link), `app/admin/page.tsx` (Listings tab surfaces the new fields when
present), `tests/unit/market-requests-route.test.ts` (new).

**What this actually is**: a dedicated `/quote` page collecting exactly
the mission's field list — product, quantity/unit, spec (optional),
origin **if known** (optional — the mission's own phrasing), destination,
required delivery date (optional), an existing supplier quotation if
available (as pasted text, not a file — see below), preferred contact
method, and mandatory consent — with the headline promise stated
verbatim: *"Know your complete landed cost before sending money."* No
login, no session, no organization required to submit. It POSTs to the
SAME public `/api/market-requests` route the existing homepage
classifieds form already uses (`role:"quote_request"` distinguishes it),
reusing that route's existing Turnstile anti-abuse gate rather than
building a second one.

**A real gap this closes, found during inspection, not assumed**: before
this, the ONLY way to get any preliminary value from this platform was
`/deal/new` → `POST /api/deals`, which has always required a full,
authenticated account (`requireUserOrResponse`) — there was no path to
"preliminary value before full account creation" at all. `/quote` is
that path; `/deal/new` is untouched (Phase 1–4 working code, not
rewritten).

**Auth boundary respected, not just asserted**: `/quote`'s own submit
response is a plain confirmation (id + status only, matching the
existing route's response shape) — it does not, and structurally cannot,
reveal a counterparty, a document, or any protected detail, because it
performs no read of any of that data. The confirmation screen offers an
OPTIONAL "create a free account" link (to `/register`) explaining what
becomes visible after — counterparties, protected introductions,
secure documents — without ever weakening the untouched auth gates that
already protect those elsewhere in the app (Priority 1).

**A real, explicit scoping decision, not a silent omission**: "supplier
quotation if available" is collected as free TEXT
(`existingQuoteNote`), not a file upload. An anonymous, unauthenticated
submitter has no account to own an uploaded file under, and this
platform's document-authorization model (Priority 1's
`canUploadDealDocument`/`canViewDealDocument`) assumes every stored file
has a real owner and a real deal to belong to — neither exists yet for
a `/quote` submission. Building anonymous file upload would mean either
weakening that model or building a parallel one; out of this priority's
scope, and documented as a real limitation, not hidden.

**Consent is a genuine gate, not decorative metadata**: `consentAt` is a
timestamp (matching this schema's existing consent convention —
`introductions.demandConsentAt`/`supplyConsentAt` — over a bare
boolean), and the API rejects a `role:"quote_request"` submission with
no `consent` field with a 400, checked server-side, not only via the
HTML `required` checkbox attribute (verified as a real attack case
below — a direct API call bypassing the browser entirely).

**Automated checks:** `tsc` 0 errors · `lint` 0 errors (45 warnings —
+3 over Priority 8's 42, all the SAME pre-existing warning classes
already present dozens of times across this codebase —
`no-html-link-for-pages`/`react-hooks/set-state-in-effect` — not a new
category) · **150/150 tests** (8 new: anonymous no-origin no-account
submission, mandatory consent rejection, base-field validation, the full
new field set persisting correctly, the pre-existing classifieds roles'
behavior proven UNCHANGED by regression tests, a forged
`organizationId` from an anonymous caller being dropped not trusted, an
invalid quantity being dropped rather than stored as a fabricated
number) · `build` clean, `/quote` present in the route manifest.

**Live browser + attack verification, not just unit tests:**
- Mobile viewport (390×844, iPhone-sized): `/quote` loads directly with
  zero NEW console errors — the one favicon 404 present is a confirmed
  PRE-EXISTING, sitewide gap (reproduced on the homepage too, which also
  has several pre-existing 502s from blocked external trade-data
  fetches in this sandboxed environment) — not something this priority
  introduced, and not silently excluded without checking first. No
  horizontal overflow at 390px.
- An empty submit is blocked by the browser (HTML5 required attributes)
  — no request is sent. Filling in only product/destination/contact
  (deliberately no origin, no spec, no delivery date, no existing
  quote — the genuinely minimal path) and checking consent → a real
  row lands in D1 with `origin:""` (never a guessed default),
  `ownerEmail: null` (truly anonymous — no account silently created),
  and a real `consentAt` timestamp.
- **Attack**: submitting without checking the consent checkbox is
  blocked client-side; a **direct API call bypassing the browser
  entirely**, with no `consent` field at all, is independently rejected
  server-side with 400 — the gate is real, not cosmetic.
- **Attack**: a direct API call from an anonymous caller supplying a
  forged `organizationId` (`"1"`, no real membership) → the request
  still succeeds (201), but the forged id is silently dropped, not
  trusted — confirmed via a direct D1 read (`organization_id: null`),
  matching Priority 1's "never trust a client-supplied id" discipline.
- **Regression, checked live not assumed**: the pre-existing homepage
  classifieds role (`"wanted"`) still requires `origin` — a direct API
  call omitting it → 400, exactly the pre-Priority-9 behavior.
- Desktop viewport (1440×900): the identical flow works end to end —
  the mobile-first CSS isn't degrading the desktop experience.
- **Accessibility tree** (a real Playwright accessibility snapshot, not
  only an automated scanner — honoring the mission's explicit
  screen-reader requirement): every textbox/combobox/checkbox/button on
  the form has a real, non-empty accessible name — 0 unnamed controls.
  The consent checkbox's accessible name is the FULL consent sentence,
  not just "I agree" — a screen reader user hears the actual
  commitment being made. **Keyboard-only**: Tab order reaches every
  field in sequence and lands on the real submit button, activatable
  without a mouse.
- The homepage carries a real, working CTA (`Get your landed cost →`)
  linking to `/quote`, verified present in a live page load, not just
  in source.
- The existing, authenticated admin desk's Listings tab — untouched
  API, only the render — correctly surfaces the new fields
  (`quantity`/`unit`, `productSpec`, `requiredDeliveryDate`,
  `preferredContactMethod`, `existingQuoteNote`) for real
  `quote_request` rows created during this verification run, confirmed
  with a live screenshot-equivalent text dump, not assumed from the
  diff.

**Remaining risks, explicitly deferred:**
- No rate limiting specific to `/quote` beyond the existing shared
  Turnstile gate on `/api/market-requests` (disabled in this
  environment — no `TURNSTILE_SECRET_KEY` configured, same
  pre-existing limitation noted for the rest of the public POST
  endpoints in Priority 2's section).
- No file-upload path for "existing supplier quotation" — text only,
  by deliberate design (see above), not by oversight.
- This priority does not yet connect a submitted `quote_request` row to
  Priority 13's future "qualified buyer requests"/"time to first useful
  quote" metrics — the data (role, timestamps, consent) is there to
  support it, but no dashboard consumes it yet; that's Priority 13's
  territory.
- `.dealform` (used by the pre-existing, auth-gated `/deal/new`) has NO
  mobile breakpoint at all and would visibly degrade on a narrow
  viewport — noticed while building this priority's genuinely
  mobile-first `.quoteform` styles, but deliberately NOT touched here:
  fixing it is unrelated to this priority's own deliverable and risks
  scope creep into "rewriting working Phase 1–4 code" the mission
  explicitly warns against. Flagged here as a real, separate follow-up.

**Commit:** `756ff5f`

---

## Priority 10 — WhatsApp-ready acquisition

**Status: implemented but not independently verified against a real
WhatsApp Business API provider** (none exists in this environment — see
below). Every code path IS real and independently verified against a
real ConsoleWhatsAppProvider and a real D1-backed test/live database —
distinguishing these two claims precisely, per the mission's own
vocabulary, rather than calling the whole priority "verified."

**Explicit stopping condition, stated plainly, not worked around**: no
WhatsApp Business API credentials (Meta Cloud API, Twilio, or any other
provider) exist in this environment. Per the mission's own rule
("missing credentials" is explicit grounds to stop and flag), this
priority builds the real, working provider-neutral adapter and webhook
interface — never a fabricated "it works" claim.

**Files changed:** `db/schema.ts` (`whatsappContacts`, `whatsappMessages`,
`secureLinks`), `drizzle/0016_lame_green_goblin.sql` (migration, all new
tables — no ALTER COLUMN),
`worker/env.d.ts` + `.dev.vars.example` (`WHATSAPP_WEBHOOK_SECRET`
declared), `lib/whatsapp.ts` (new — the provider adapter, mirroring
`lib/email.ts`'s exact pattern), `lib/secure-links.ts` (new, reusing
`lib/auth/tokens.ts`'s hash-only-storage convention),
`lib/whatsapp-notify.ts` (new — the one real caller for milestone
notifications), `app/api/webhooks/whatsapp/route.ts` (new, inbound),
`app/api/whatsapp/link/route.ts` (new, authenticated phone linking),
`app/link/[token]/page.tsx` (new, secure-link landing/handoff),
`app/api/admin/desk/route.ts` (milestone-verification branch now
attempts a real WhatsApp notification; GET now includes the WhatsApp
audit data), `app/admin/page.tsx` + `app/admin.css` (new WhatsApp tab),
`tests/unit/stubs/next-navigation.ts` (extended, not replaced — the
redirect stub now carries its destination in the thrown error so a test
can assert where it redirected to; verified nothing in the repo
string-matched the old exact message before changing it),
`tests/unit/whatsapp.test.ts` (new).

**Mission checklist, mapped to what was actually built:**
- *"Provider-neutral messaging adapter"* — `lib/whatsapp.ts`, exactly
  mirroring `lib/email.ts`'s existing adapter pattern rather than
  inventing a second design: an interface, a `ConsoleWhatsAppProvider`
  that logs instead of delivering, `getWhatsAppProvider()` as the one
  swap point for a real provider later.
- *"Webhook interface"* — `app/api/webhooks/whatsapp/route.ts` accepts a
  NORMALIZED `{from, text, messageId?}` shape, not any one real
  provider's actual payload format (Meta Cloud API, Twilio, etc. each
  differ) — a real integration's job is translating its provider's
  webhook into this shape, which doesn't exist yet because no provider
  is connected. Checks `WHATSAPP_WEBHOOK_SECRET` when configured
  (unconfigured here — processes anyway, exactly mirroring
  `lib/turnstile.ts`'s honest not-verified/not-enforced pattern rather
  than pretending every request is authentic).
- *"Inbound quote requests"* — an inbound message's raw text becomes a
  real `marketRequests` row (`role:"quote_request"`, the SAME table and
  role Priority 9's `/quote` page uses) with the text stored VERBATIM as
  `product` — deliberately NOT parsed/guessed into structured
  product/destination fields (that would be fabricating structured data
  from an unstructured signal); a human reviewer on the existing admin
  Listings tab follows up, exactly like a `/quote` submission.
- *"Structured follow-ups"* — every inbound/outbound message is logged
  to `whatsappMessages` with `relatedEntityType`/`relatedEntityId`,
  giving a real thread per deal/contact for a future structured-flow
  builder to read; the flow logic itself (multi-step guided replies) is
  not built — a real, stated limitation, not a silent gap.
- *"Consent tracking"* — `whatsappContacts.consentAt`, a real timestamp,
  DELIBERATELY SEPARATE from Priority 9's `marketRequests.consentAt`
  (see `db/schema.ts`'s header: different real-world policies, must not
  be conflated). Set by an authenticated user explicitly linking a
  number (`app/api/whatsapp/link/route.ts`) or by a real inbound message
  (WhatsApp's own real-world "user-initiated message implies session
  consent" convention).
- *"Opt-out"* — a real STOP-keyword detector (`looksLikeOptOut`, a fixed
  keyword match — Priority 6's AI decision boundary: not an NLP
  judgment call) on the inbound webhook, PLUS a real, safe self-service
  path: every outbound message gets a unique, single-purpose secure link
  appended, because a public "type any phone number to opt it out" form
  would let anyone silence a competitor's notifications — a real
  security consideration acted on, not just noted.
- *"Delivery status"* — `whatsappMessages.deliveryStatus` is
  `"not_configured"` for every send while only `ConsoleWhatsAppProvider`
  is active — NEVER `"sent"`/`"delivered"`, which would be a fabricated
  claim.
- *"Milestone notifications"* — the one real trigger wired end-to-end:
  `app/api/admin/desk/route.ts`'s milestone-verification branch (a
  previously notification-free code path — confirmed by inspection, not
  assumed) now attempts a real WhatsApp send via
  `lib/whatsapp-notify.ts`, purely additive (wrapped so a notification
  failure can never break the actual milestone review, which is the
  real product action).
- *"Secure expiring links to TradeSafe"* — `lib/secure-links.ts` +
  `app/link/[token]/page.tsx`. **This does NOT bypass authentication**:
  resolving a link just proves "a specific notification was actually
  sent to this number, recently," then hands off via `redirect()` to
  the SAME auth-gated destination (`/deal/:id`) every other path already
  uses — Priority 1's real authorization still applies in full, verified
  live below with a signed-out visitor.
- *"Never send identity docs/bank details/confidential evidence"* —
  structurally enforced, not just a comment: `notifyMilestoneEventByWhatsApp`'s
  function signature only accepts a short `summary` string (e.g.
  "evidence verified") — there is no parameter through which raw deal
  content, a document, or evidence could ever reach a WhatsApp message
  body. Verified live: the real sent message contains the milestone
  name and deal reference only, plus a link — never the evidence itself.
- *"Audit history"* — every inbound/outbound message, and every
  contact's consent/opt-out standing, is queryable by reviewers on the
  new admin WhatsApp tab, sourced from the exact same real rows the
  webhook and notification paths write.

**Automated checks:** `tsc` 0 errors · `lint` 0 errors (49 warnings, +4
over Priority 9's 45, all the same pre-existing `no-html-link-for-pages`
class already present dozens of times in this codebase, not a new
category — one genuinely new issue WAS caught and fixed: an unescaped
apostrophe in a JSX text node, `react/no-unescaped-entities`, the one
actual lint ERROR hit and fixed before this section was written) ·
**177/177 tests** (27 new: consent/opt-out state machine including
pre-emptive opt-out of a never-contacted number, send refusal for both
no-consent and opted-out with the real reason recorded, honest
`not_configured` delivery status, the opt-out keyword matcher's real
false-positive guard ("please stop by the office" ≠ opt-out), secure-link
create/resolve/expire/not-found/multi-open-doesn't-invalidate, the raw
token never being recoverable from the stored row, the `/link/:token`
Server Component's real redirect target AND its real opt-out side
effect, both WhatsApp routes' auth/validation, the inbound webhook's
real STOP handling and real quote-request creation with verbatim (never
parsed/guessed) text, and the full milestone→WhatsApp integration in
both directions — a deal owner WITH and WITHOUT a linked number) ·
`build` clean, all three new routes present in the route manifest.

**Live browser + attack verification, not just unit tests:**
- A real trader links a real E.164 number via the authenticated API;
  confirmed via direct D1 read: a genuine `consentAt`, correct
  `linkedEmail`, no `optOutAt`.
- **Attack**: linking a number with no session → 401. **Attack/validation**:
  a non-E.164 phone number → 400.
- A real deal + milestone created through the real UI; an administrator
  verifies the milestone through the real admin desk → a REAL outbound
  `whatsappMessages` row is created, `deliveryStatus:"not_configured"`
  (never fabricated as delivered), containing the deal reference and
  milestone name **and never the product name or any deal detail beyond
  those two identifiers** — confirmed by directly asserting the raw
  product text is ABSENT from the message body.
- The real secure link extracted from that real message body, followed
  by the real, signed-in deal owner in a real browser → lands on the
  real `/deal/:id` page.
- **Attack**: the SAME real link followed by a signed-out visitor → does
  NOT reveal deal content — redirected to `/login`, exactly Priority 1's
  existing behavior for `/deal/:id` directly, proving the secure link
  really is a handoff, not a second, weaker authentication path.
- An invalid/nonexistent token in the URL → an honest "not valid"
  message, no crash, no redirect.
- A real inbound webhook call with ordinary text → visible, verbatim, on
  the existing admin Listings tab after a real reload — no separate
  review surface needed, it reuses Priority 9's own queue.
- A real inbound STOP message via the webhook → the sender's number is
  genuinely opted out, confirmed by direct D1 read — and a subsequent
  milestone-review notification attempt to that number is refused
  (`reason:"opted_out"`) without breaking the milestone review itself
  (still returns 200).
- The admin WhatsApp tab, loaded fresh: zero console errors, shows the
  real contact and the real message body.
- **Accessibility tree** (a real Playwright snapshot): the `/link/:token`
  landing page's heading and every link have real, non-empty accessible
  names; keyboard Tab reaches a real focusable element first.
- Mobile viewport (390×844): no horizontal overflow on the secure-link
  landing page.

**Remaining risks, explicitly deferred, and the honest reason for
"implemented but not independently verified":**
- **No real WhatsApp Business API provider connected** — this is the
  headline limitation, stated once here and not repeated as a caveat on
  every bullet above: nothing in this priority has been exercised
  against Meta's Cloud API, Twilio, or any other real provider, because
  none is available in this environment. Connecting one means
  implementing a real `WhatsAppProvider` (swap point already built),
  wiring that real provider's own webhook payload shape into the
  existing normalized `{from, text}` interface, and setting
  `WHATSAPP_WEBHOOK_SECRET` for real signature verification.
- No structured multi-step follow-up FLOW logic (e.g., "reply 1 for
  buying, 2 for selling") — the message log/thread data model supports
  building one later; the conversational logic itself is not built.
- No phone-number verification (an OTP/confirmation step) when a user
  links a number via `app/api/whatsapp/link/route.ts` — that also
  requires a real provider to send a real verification code through.
  Documented as a real gap, not hidden.
- The milestone-notification trigger is the ONE wired event, matching
  the mission's explicit naming — deal-stage transitions, dispute
  updates, and other notification-worthy events are not wired to
  WhatsApp yet (they could reuse the same `sendWhatsAppMessage`
  primitive; not done in this priority to keep the change focused).
- `APP_ORIGIN` (`https://tradesafe.africa`) is a documented placeholder
  — no production domain is provisioned in this environment (see
  `docs/DEPLOYMENT.md`); a real deploy must set this from the actual
  origin or every secure link generated will point at a non-existent
  domain.

**Commit:** `9a6451e`

---

## Priority 11 — Brokers, associations, referrals

**Status: verified**, with one explicit, deliberate scope boundary
carried over from the mission's own text, not a limitation found along
the way: **no money-movement code exists anywhere in this priority** —
"don't pay commissions until legal/accounting requirements are defined
— may track pending/approved obligations without transferring money."

**Files changed:** `db/schema.ts` (`referralPartners`,
`referralAttributions`, `commissionRecords` — all new),
`drizzle/0017_even_sphinx.sql` (migration, all new tables),
`lib/referrals.ts` (new — code generation, attribution, fraud/self-
referral checks, the public resolver), `app/api/referrals/route.ts`
(new), `app/api/admin/commissions/route.ts` (new), `app/r/[code]/page.tsx`
(new, public disclosure landing page), `app/api/market-requests/route.ts`
+ `app/quote/page.tsx` (carry an optional `ref` code through to
attribution), `app/api/auth/register/route.ts` + `app/register/page.tsx`
(same, for direct signups), `app/deal/[id]/page.tsx` +
`app/components/DealPartiesAndReferrals.tsx` (new — post-deal UI),
`app/admin/page.tsx` + `app/admin.css` (new Referrals tab),
`tests/unit/referrals.test.ts` (new).

**"Broker/association profiles" already existed** — `organizations` +
`ORGANIZATION_ROLES` already included `"broker"` since Phase 2; this
priority deliberately did not build a parallel profile system, only the
referral/attribution/commission-tracking layer on top. Code creation is
NOT role-gated: any real, active organization member can generate one —
covering both a broker referring a client AND the mission's separate
"post-deal: refer buyer/supplier" requirement with one mechanism instead
of two.

**The money-movement boundary is enforced structurally, not by
convention** — `COMMISSION_STATUSES` in `db/schema.ts` has no `"paid"`
value, so `app/api/admin/commissions/route.ts`'s whitelist check against
that real enum cannot let a `"paid"` transition through even if someone
tried; there is no function anywhere in this codebase that could execute
one even if the status check were bypassed. Verified live as a genuine
attack case, not just a code-read: a direct API call attempting
`status:"paid"` → 400, and the record's real status in D1 confirmed
unchanged.

**"Protected buyer-broker relationships" — first-attribution-wins,
verified with an actual contested case**: two real referral codes from
two different organizations both attempted to attribute the SAME
referee; the first attribution stayed `isPrimary:true`, the second was
recorded (full audit history preserved, never silently dropped) but
`isPrimary:false` with `fraudFlag:"duplicate_attribution"` — and does
not count toward anything.

**Fraud/self-referral controls, both checked against real rows, never
inferred from a name/domain match**: the referring organization's OWNER
cannot be attributed under their own code, and neither can a real,
active MEMBER of that organization — both verified live (a broker
attempting to self-refer still gets their quote request accepted
normally, but the attribution itself is flagged `self_referral` and
excluded from credit).

**Disclosure of who pays commissions — a real, required field, not an
afterthought**: `commissionRecords.payerParty` is mandatory at the API
layer (`payerParty` empty → 400, "commissions must always disclose who
pays them"), and `app/r/[code]/page.tsx`'s public disclosure text states
the mechanism generically (a specific commission amount/payer is only
ever decided per-deal by an administrator, long after a visitor sees
this page — resolving a code returns ONLY a public organization name,
structurally nothing else, so the disclosure page cannot leak a
specific figure even by mistake).

**Never revealed private deal details through referral links** —
verified directly: the disclosure page's content never contains a
dollar figure or any deal-specific text; `lib/referrals.ts`'s
`resolveReferralPartner` return type has no field through which one
could leak.

**Post-deal actions, matching the mission's explicit list:**
- *"Invite a participant"* — Priority 1 built `POST/DELETE
  /api/deals/:id/parties` with no UI form calling it, a real gap
  confirmed by inspection before building anything; `DealPartiesAndReferrals.tsx`
  is that missing UI, reusing the existing API unchanged.
- *"Refer buyer/supplier"* / *"transparent referral credit"* — the same
  deal room now has a "Get a referral link" action generating a real
  `/r/[code]` link for the deal owner's organization.
- *"Start repeat transaction"* — a plain link on the deal page to
  `/deal/new` prefilled with the real deal's product/HS
  code/origin/destination, reusing `/deal/new`'s EXISTING query-param
  prefill mechanism (built in an earlier phase, previously only reachable
  from the Opportunity Finder) rather than duplicating that logic.
- *"Reuse spec"* — covered by the same prefill link above.

**A real bug found and fixed during Loop Engineering, not before
shipping — caught by the live browser verification itself, not a code
read**: the first draft of `app/api/admin/commissions/route.ts`'s GET
filtered `referralAttributions` to `isPrimary:true` only, copying the
(correct, for a different reason) filter already used in
`app/api/referrals/route.ts`'s own GET. Since a fraud-flagged attribution
is BY DEFINITION never primary, that filter silently hid every
self-referral/duplicate-attribution flag from the admin Referrals tab —
exactly the rows fraud review most needs to see. Caught live: the admin
tab's "Flagged" section was rendering as if zero flags existed even
though a real one had just been created in the same test run. Fixed by
removing the filter from the admin GET specifically (the org's own
performance-stat GET correctly keeps it — a different real question:
"how many referees actually counted for me" vs. "show reviewers
everything, including what didn't count").

**Automated checks:** `tsc` 0 errors · `lint` 0 errors (52 warnings, +3
over Priority 10's 49, the same pre-existing `no-html-link-for-pages`
class; two real ERRORS were hit and fixed — unescaped apostrophes in
JSX text, the same category caught in earlier priorities) ·
**198/198 tests** (23 new: code generation/uniqueness, the public
resolver's PII-free return shape, clean attribution, both self-referral
cases, the contested-attribution protected-relationship proof with full
history preserved, suspended/nonexistent-code no-ops, membership-gated
code creation with a real 403 for a non-member, commission validation
(`payerParty` required, basis-specific rate/flatAmount required, real
deal/partner existence checks), the "paid" status attack rejected by
the real enum whitelist, approval recording a real approver+timestamp,
and end-to-end registration/quote-request attribution integration) ·
`build` clean, all four new routes present in the route manifest.

**Live browser + attack verification, not just unit tests:**
- A real broker creates a real organization, generates a real referral
  code. **Attack**: a non-member of that organization attempting the
  same → 403.
- The public `/r/[code]` page loads with zero console errors, discloses
  the real organization's name, explains the commission mechanism
  honestly ("never funded or transferred through this platform"), and
  contains no dollar figure or deal detail.
- The code carries through, as a real query param, from the disclosure
  page → `/quote` → the real submission → a real, primary,
  `fraudFlag:""` attribution row confirmed via direct D1 read.
- **Attack**: the broker attempts to self-refer under their own code —
  the quote request itself still succeeds normally (201), but the
  attribution is flagged `self_referral` and NOT primary, confirmed via
  direct D1 read — no credit silently granted.
- An administrator records a real, tracked-only commission obligation.
  **Attack**: a direct API call attempting `status:"paid"` → 400, the
  record's real status confirmed unchanged in D1. The administrator CAN
  approve it (a real, different action — marking an obligation
  legitimate, not paying it) → 200.
- The admin Referrals tab, loaded fresh: zero console errors, shows the
  real broker organization, the real commission record, AND the real
  flagged self-referral (the bug above, confirmed fixed by re-running
  this exact live check after the fix).
- A real deal room shows the real PARTICIPANTS and REFERRALS sections
  with zero console errors; inviting a participant through the real UI
  form creates a real `deal_parties` row, confirmed via direct D1 read
  (not assumed from a 200 response); the real "Get a referral link"
  button generates a real, working `/r/[code]` link; the real "Start a
  repeat transaction" link is present.
- **Attack**: an anonymous visitor attempting to invite a participant on
  someone else's deal via a direct API call → 401.
- **Accessibility tree** (a real Playwright snapshot): every link and
  heading on the disclosure page has a real, non-empty accessible name;
  keyboard Tab reaches a real focusable element first. Mobile viewport
  (390×844): no horizontal overflow.

**Remaining risks, explicitly deferred:**
- **No money-movement code — by design, per the mission's own stopping
  condition, not an oversight.** Approving a commission record is a
  platform decision that an obligation is legitimate and tracked; it is
  never a payment instruction. Building an actual payment/disbursement
  path requires a legal/accounting decision this session cannot make.
- No fraud check for a referrer generating MANY codes to route around
  the duplicate-attribution protection (e.g., referring the same
  contested lead under a freshly generated second code from the SAME
  org) — the current check only catches a referee already having a
  PRIMARY attribution from ANY code, which does catch this case at the
  attribution level, but a determined actor cycling through many orgs
  they control is not specifically detected; a real limitation for a
  future fraud-review pass, not hidden.
- Commission amounts are entered by a reviewer, not computed
  automatically from the deal's actual landed cost/quote — Priority 12
  (landed-cost accuracy) is the natural future source for an
  auto-suggested `rate`/`flatAmount`, not wired together yet.
- No email/WhatsApp notification when a referral converts into a real
  attribution or a commission is approved — the referring organization
  currently has to check the admin GET (`/api/referrals`) themselves;
  Priority 10's `sendWhatsAppMessage` primitive could carry this later,
  not wired in this priority to keep the change focused.

**Commit:** `adb14c1`

---

## Priority 12 — Landed-cost accuracy

**Status: verified.**

**Files changed:** `db/schema.ts` (`landedCostEntries` — new, additive),
`drizzle/0018_dry_wallflower.sql` (migration, one new table),
`lib/landed-cost.ts` (new — recording, breakdown computation, deal-
creation seeding), `app/api/deals/[id]/landed-cost/route.ts` (new),
`app/api/deals/route.ts` (wires seeding into deal creation),
`app/components/LandedCostBreakdown.tsx` (new),
`app/deal/[id]/page.tsx` (renders it), `tests/unit/landed-cost.test.ts`
(new).

**What this adds, precisely, on top of what already existed**: Phase 3's
`dealCosts` (one flat number per component) and `quotes` (a real,
counterparty-sourced single-point breakdown) already existed and are
UNCHANGED — this priority doesn't replace either, it adds the itemized,
sourced, ranged layer the mission specifically asks for that neither of
those provided: low/expected/high estimates, confidence, source +
source date, explicit unknown/excluded flagging, and — the one
genuinely new capability — real actuals recorded after delivery with a
real computed variance.

**"Calculate goods+transport+insurance+duties+taxes+brokerage+
inspection+financing+TradeSafe fees" — all nine categories now
genuinely exist**, including three the platform never tracked at all
before this priority (`brokerage`, `tradesafe_fees`, and — found by
inspection before writing anything — `insurance`/`inspection` were
schema columns on `dealCosts` that the actual `/deal/new` form has
never had inputs for, always silently defaulting to 0).

**"Never fabricate precision" enforced in the seeding logic itself, not
just in the display**: `insurance` and `inspection` are seeded as
EXPLICITLY EXCLUDED (`isExcluded:true`, with a real stated reason) when
the request genuinely didn't supply a value — never as $0, which would
misreport "not asked" as "known to cost nothing." `low`/`high` stay
`null` on every seeded estimate, because a single trader-typed number is
not a range; fabricating one by copying the point value into both would
manufacture a false confidence interval. `tradesafe_fees` is seeded at a
real, checked fact (this codebase currently has no fee/billing logic
anywhere — confirmed by inspection, not assumed) at `high` confidence,
with the assumption stated explicitly rather than silently implied
permanent.

**"Present low/expected/high ... unknown/excluded costs"** —
`getLandedCostBreakdown()`'s totals are honestly `null` for `low`/`high`
the moment even ONE contributing component lacks a real range (verified:
summing a partial set of low bounds and calling it "the low total" would
itself be a fabricated precision claim) — excluded components are
listed separately, never silently dropped from the response and never
folded into the totals.

**"After delivery, record actuals and calculate variance"** — a real,
owner-only write path (`phase:"actual"`, REQUIRES a real `source` —
"a document to check it against," not a bare number) computes
`variance = actual − estimate` per component. Verified live end-to-end:
a real deal's real "goods" estimate ($10,000), a real actual recorded
through the real UI form ($10,450, sourced to a specific invoice
number) → a real +$450 variance rendered on the page.

**"Never show ... unsupported profit claims, guaranteed savings/
profit"** — the variance is displayed as a plain signed figure "vs.
estimate," never phrased as savings or profit anywhere in
`LandedCostBreakdown.tsx`; verified with a live regex check against the
rendered page text for exactly that language, and a repo-wide sweep
(`grep -rniE "guaranteed (profit|savings|return)|100% (profit|accurate)|risk-free"`)
found none anywhere in the app, not only in the new code.

**Append-only, same convention as corridor_templates/
organization_verifications/exceptions**: a re-estimate is a NEW row for
the same `(dealId, componentType, phase)`, never an UPDATE — "latest
wins" for what counts as current, full history preserved for what was
assumed, by whom, and when, before it changed. Verified: two estimate
rows for the same component both persist in D1; the breakdown correctly
surfaces only the newer one.

**Automated checks:** `tsc` 0 errors · `lint` 0 errors (53 warnings, +1
over Priority 11's 52, the same pre-existing warning class) ·
**210/210 tests** (12 new: seeding never fabricates a range, genuinely
uncollected components excluded not zeroed, the honest
`tradesafe_fees` fact, a real range computing correctly into totals, a
partial range honestly nulling the total, real variance computation, a
re-estimate preserving history, and the route's real deal-access
gating, range sanity checks, and actual-requires-a-source rule) ·
`build` clean, the new route present in the route manifest.

**Live browser + attack verification, not just unit tests:**
- A real deal created through the real `/deal/new` form with real cost
  figures → real, sourced `landed_cost_entries` rows confirmed via
  direct D1 read for every one of the nine component categories; the
  `goods` entry carries the exact `supplierCost` the trader typed;
  `insurance` is confirmed EXCLUDED with the honest reason text, not a
  fabricated $0; `tradesafe_fees` confirmed at the honest stated fact.
- The deal page renders the real breakdown with zero console errors,
  showing the real estimate, a real confidence rating, and a real
  "NOT YET ESTIMATED" section listing the genuinely excluded
  components.
- **Attack**: an unrelated signed-in user (no relationship to this
  deal) → `GET` the breakdown → 404 (not 403 — existence not revealed,
  matching Priority 1's convention); the same user attempting to
  `POST` a cost entry → 404.
- **Attack**: a direct API call with a nonsense range
  (`lowAmount > expectedAmount` and `highAmount < expectedAmount`) →
  400, naming exactly which bound was invalid.
- The real owner refines an estimate with a real range via the API,
  then records a real actual through the real UI form (component,
  amount, a real invoice-number source) → confirmed via direct D1 read;
  the page reload shows a real Variance figure.
- **Attack**: recording an actual with no source → 400.
- **Accessibility tree** (a real Playwright snapshot): every form
  control on the deal page (including the new "record actual" form)
  has a real, non-empty accessible name. Mobile viewport (390×844): no
  horizontal overflow on the deal room with the new section added.

**Remaining risks, explicitly deferred:**
- No UI path (only a direct API call, verified working) for a reviewer
  to refine an estimate's low/high range or confidence — the live UI
  form only exposes recording an actual; adding a full estimate-editing
  UI was judged lower priority than the actuals/variance path the
  mission specifically calls out, and is a real, stated gap, not
  hidden.
- Variance is computed only per-component; no rolled-up "total actual
  vs. total estimate" percentage or chart — the raw numbers are all
  present in the API response for a future dashboard (Priority 13's
  natural territory) to compute one honestly, not fabricated here in
  the meantime.
- `dealCosts.sourceStatus` (a schema column that predates this
  priority) remains effectively unused — noticed during inspection, not
  wired into this priority's model since it would mean touching Phase
  1–4's existing, working `dealCosts` write path; flagged as a
  cleanup opportunity, not addressed here.

**Commit:** `0211d9a`

---

## Priority 13

**Status: Fully verified.** The final priority in the mission's list —
a real business-validation dashboard reading exclusively from data
already recorded by Priorities 1–12, never from registrations, listing
counts, or page views.

**Files changed:**
- `lib/business-metrics.ts` (new) — `computeBusinessMetrics()`, a
  single real aggregation function reading `marketRequests`,
  `organizations`, `referralAttributions`, `deals`, `quoteRequests`/
  `quotes`, `landedCostEntries` (via `getLandedCostBreakdown()`),
  `adminAuditEvents`, `milestones`, `dealEvents`, and `disputes`
  directly. Every metric that cannot be honestly computed from real
  data returns `{available:false, reason:"..."}` instead of a
  fabricated or zeroed value.
- `app/admin/metrics/page.tsx` (new) — a Server Component,
  `requirePlatformRole("/admin/metrics", ["administrator"])`.
  Deliberately narrower than the rest of `/admin` (excludes
  `verification_analyst` — business-level traction data is a
  different real access question from evidence review).
- `lib/deal-stages.ts` — promoted a shared `stageIndex()` export (was
  a private duplicate inside `lib/exceptions.ts`).
- `lib/exceptions.ts` — now imports `stageIndex` from
  `lib/deal-stages.ts` instead of duplicating it; removed the
  now-unused `DEAL_STAGES` import.
- `app/admin/page.tsx` — added a real, working nav link to
  `/admin/metrics` from the main verification desk.
- `tests/unit/business-metrics.test.ts` (new, 12 cases).

**Mission-checklist mapping:**
- **"Track: qualified buyer requests, verified suppliers,
  partner-referred leads"** — real counts from `marketRequests`
  (`role:"quote_request"`, by status), `organizations`
  (`verificationStatus:"verified"`), and `referralAttributions`
  (`isPrimary:true`, split by real `source`: `intake_link` vs.
  `code_entry`). Fraud-flagged/non-primary attributions are correctly
  excluded, matching the Priority 11 convention.
- **"Track: acquisition cost per qualified buyer, revenue per
  transaction"** — **always** `{available:false}` with a real, stated
  reason (no billing or marketing-spend tracking exists anywhere in
  this codebase). Verified live and in tests: these two figures never
  render as `$0` or any number, only as "Not tracked" plus the reason
  sentence.
- **"Track: time to first useful quote, quote→payment-confirmed
  conversion, transactions initiated/completed, repeat-transaction
  owners"** — time-to-quote is a real day-delta between deal creation
  and the first row in `quotes` for that deal's `quoteRequests`;
  conversion is real deals-with-a-quote reaching `stage:"closed"`
  divided by deals-with-a-quote; initiated/completed read `deals.stage`
  directly; repeat owners count `ownerEmail`s with 2+ deals.
- **"Track: landed-cost accuracy, manual interventions per
  transaction, verification turnaround, on-time milestones"** —
  landed-cost variance reuses Priority 12's `getLandedCostBreakdown()`
  per deal and averages real actual-vs-estimate percentages (honestly
  unavailable when no deal has a recorded actual yet); manual
  interventions counts real `adminAuditEvents` rows per deal
  (documented in-page as an approximation, since audit events aren't
  currently joined to a specific check/document); verification
  turnaround reads the real `dealEvents` `stage_transition` row whose
  summary records `→ counterparties_verified`; on-time milestones
  compares the earliest `adminAuditEvents` row verifying a milestone
  against that milestone's real `dueAt`.
- **"Track: disputes and resolution time"** — real counts by
  `disputes.status`, real average `resolvedAt − createdAt` in days,
  honestly unavailable when nothing has resolved yet.
- **"Do NOT prioritize registrations, listing counts, or page views as
  proof of traction"** — the dashboard never renders a "total users" /
  "total registrations" headline tile, and states in its own visible
  copy that it never uses registrations, listings, or page views as
  evidence.

**Automated checks:** `tsc` 0 errors · `lint` 0 errors (54 warnings,
+1 over Priority 12's 53, the same pre-existing `no-html-link-for-pages`
warning class — this page's nav uses a plain `<a>`, matching every
other admin page in the app) · **221/221 tests** (12 new: empty-platform
honesty, both always-unavailable metrics carrying a real reason,
qualified-buyer-request status counting, verified-supplier counting,
partner-referred-lead counting by source with fraud-flagged rows
excluded, time-to-first-quote, transactions initiated/completed/repeat
owners, landed-cost variance %, disputes counting + resolution time,
on-time milestones, verification turnaround) · `build` clean.

**Live browser + attack verification, not just unit tests:**
- **Attack**: an anonymous visitor requesting `/admin/metrics` is
  redirected to `/login`, never sees any business data.
- **Attack**: a real `verification_analyst` account (a genuine
  reviewer role, but not `administrator`) is also redirected away —
  confirming the dashboard's gate is deliberately narrower than the
  rest of `/admin`.
- A real `administrator` account loads the dashboard with **zero
  console errors**.
- Confirmed live: no "TOTAL USERS"/"TOTAL REGISTRATIONS" headline tile
  anywhere on the page; the page's own copy explicitly states it never
  uses registrations, listings, or page views as traction proof.
- Confirmed live: acquisition-cost-per-qualified-buyer renders as
  "Not tracked" with the real "no acquisition spend is tracked" reason
  text, not a fabricated number; revenue-per-transaction renders as
  "Not tracked" with the real "does not currently charge" reason text,
  not a fabricated `$0`.
- A real deal created live through `/deal/new` → the dashboard's
  TRANSACTIONS INITIATED figure, re-read after the deal's creation,
  matched the real, current `SELECT COUNT(*) FROM deals` figure read
  directly from D1 — proving the number is live-computed, not cached
  or stale.
- **Accessibility tree** (a real Playwright snapshot): every heading
  and link on the page has a real, non-empty accessible name.
- **Mobile viewport (390×844): no horizontal overflow** — this caught
  a real bug (below).
- The main `/admin` verification desk has a real, working link to
  `/admin/metrics`.

**Real bug found and fixed during live verification:** the dashboard's
"manual interventions" description originally read a literal
`admin_audit_events`-style underscored token. With no word-break
opportunity, that unbroken string forced CSS Grid's `1fr 1fr` mobile
layout into unequal computed column widths (204.875px vs. 186.219px in
a 351px container), overflowing the 390px mobile viewport by 21px.
Root-caused via `getBoundingClientRect()` sweeps and
`getComputedStyle().gridTemplateColumns` inspection on the specific
`.roommetrics` section, then fixed by rewording the copy to natural,
breakable English ("real admin actions logged per deal") — re-verified
clean on the same 390px viewport. This is a real, generalizable bug
class: any user-facing copy containing a long code/table-name literal
with no natural break points can force unequal grid columns and
overflow on narrow viewports; the fix here was to avoid code-literal
copy in user-facing text generally, not just in this one sentence.

**Remaining risks, explicitly deferred:**
- `manualInterventionsPerTransaction` is a documented approximation —
  it counts all `adminAuditEvents` rows scoped to a deal or its
  milestones, not interventions precisely attributable to that one
  transaction's specific checks; a future priority could tighten this
  by joining audit events to their originating entity more precisely.
- No historical trend view (day-over-day or week-over-week deltas) —
  every figure is a real point-in-time snapshot as of page load; a
  time-series view was judged out of scope for this priority's mission
  ("a dashboard," not "a BI system").
- No CSV/export path for these figures — internal-only, read live in
  the browser; exporting was not part of the mission checklist.

**Commit:** `7eda7e2`

---

All 13 priorities from the original specification are now complete.
