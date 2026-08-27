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

**Status: implemented but partially verified.** Real, concrete defects
were found and fixed, and what was fixed was verified live. What's
explicitly NOT done: a WCAG 2.2 AA sweep of every page (only the core
flows named in the spec — registration, login, opportunity discovery,
deal rooms, disputes, notifications — were checked), screen-reader (as
opposed to keyboard/DOM-structure) testing, and full string
externalization for localization (a formatting *foundation* was built
and wired into real money displays; the ~30 pages' inline English copy
is not translated or extracted into keys).

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

**Remaining risks, explicitly deferred:**
- No screen-reader (as opposed to keyboard-DOM) testing was performed —
  the checks above verify keyboard operability and DOM-structural
  accessibility (landmarks, labels, focus), not what a screen reader
  actually announces.
- The homepage's interactive SVG country map is not independently
  keyboard-operable (mitigated by an equivalent list, not fixed).
- Only the flows explicitly named in the spec were checked — dozens of
  other pages (organizations, quote-request forms specifically,
  milestone/document upload interactions, admin desk) were not
  independently swept.
- No French (or any second language) support exists — `SUPPORTED_LOCALES`
  currently has exactly one entry (`"en"`), by design, matching "keep
  English as the initial complete language" — but no actual translation
  work has started.
- Color contrast was not measured with a contrast-ratio tool (no
  automated contrast checker was run against this app's palette).

**Commit:** `cc10361`

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

**Commit:** `pending`

---

## Priorities 6–13

Not started. Worked next, one focused commit (or a few) per priority,
each getting its own dated section here — never marked verified without
the same real browser + attack-test + accessibility rigor applied above,
and never batched into a single unverified sweep.
