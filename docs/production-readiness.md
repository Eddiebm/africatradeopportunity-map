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

**Commit:** `pending` — will be filled in after this section is
committed.

---

## Priorities 3–13

Not started. Worked next, one focused commit (or a few) per priority,
each getting its own dated section here — never marked verified without
the same real browser + attack-test + accessibility rigor applied above,
and never batched into a single unverified sweep.
