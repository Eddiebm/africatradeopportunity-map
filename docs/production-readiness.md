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

## Priorities 2–13

Not started. Per the mandated execution order, Priority 1's full loop
(including this document) is complete first; the remaining priorities are
worked next, one focused commit (or a few) per priority, each getting its
own dated section here — never marked verified without the same real
browser + attack-test + accessibility rigor applied above, and never
batched into a single unverified sweep.
