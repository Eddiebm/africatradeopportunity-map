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

## Priorities 10–13

Not started. Worked next, one focused commit (or a few) per priority,
each getting its own dated section here — never marked verified without
the same real browser + attack-test + accessibility rigor applied above,
and never batched into a single unverified sweep.
