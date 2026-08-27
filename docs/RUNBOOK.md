# Operational runbook

Priority 3 (docs/production-readiness.md): "Operational runbook for
critical failures." Short and honest on purpose — this is written for a
real incident, not as a completeness exercise. Update it whenever a real
incident reveals it was wrong or incomplete; a runbook that hasn't been
touched since launch is a runbook nobody trusts.

## Where to look first

- **`/api/health`** — unauthenticated, checks D1 connectivity. `200
  {"status":"ok"}` means the Worker is up and can reach the database.
  `503 {"status":"degraded"}` means D1 is unreachable — see "Database
  unreachable" below.
- **`wrangler tail`** (or the Cloudflare dashboard's Logs tab —
  `wrangler.jsonc`'s `observability.enabled`) — live request/error
  stream. Every unhandled error is one structured JSON line
  (`lib/observability.ts`) carrying a `correlationId` that also appears
  in the `x-correlation-id` response header on the failed request — if a
  user reports "it broke," ask for that header's value (visible in
  browser dev tools' Network tab) to find the exact log line.
- **`GET /api/admin/cron-runs`** (administrator only) — last 50 runs of
  the daily intelligence-watchlist refresh, with status and error
  message. A `failed` status here, or no new row in >24h, means the Cron
  Trigger isn't running or is failing — see "Cron not running" below.
- **`security_events` table** — authentication activity (login
  success/failure, logout, registration, password reset). A spike in
  `login_failed` rows for one email or one IP is a credential-stuffing
  signal; query it directly via `wrangler d1 execute ... --remote
  --command "SELECT ..."` (no admin UI for this yet — see remaining
  risks in docs/production-readiness.md).
- **`admin_audit_events` / `deal_events` / `dispute_events` /
  `document_audit_events`** — what actually happened, by whom, in what
  order. The first place to look when reconstructing "what happened to
  this specific deal/dispute/document."

## Site returning errors / down

1. Check `/api/health`. If `database: "error"`, this is a D1 outage or
   misconfiguration — check Cloudflare's status page and this Worker's
   `wrangler.jsonc` D1 binding hasn't drifted from the real database id.
2. If `/api/health` itself times out or 5xxs, check `wrangler
   deployments list` — a bad deploy is the most likely cause. `wrangler
   rollback` to the previous deployment (see docs/DEPLOYMENT.md §8).
   Rollback reverts code only, not D1 migrations — if the bad deploy
   shipped a migration, the rollback alone will not fix a schema
   mismatch; the migration needs its own hand-written reverse migration.
3. Tail logs (`wrangler tail`) for the actual error — every uncaught
   exception is now logged centrally (`worker/index.ts`'s fetch wrapper,
   Priority 3) with a correlation id, method, and pathname, even for
   errors that happen outside an individual route's own try/catch.

## Database unreachable

`/api/health` returns `503`. This is almost certainly a Cloudflare D1
platform issue (check status.cloudflare.com) or an account/billing issue,
not application code — there's nothing in this app's request path that
can make D1 itself unreachable. No app-level mitigation exists (no read
replica, no cache-behind-D1) — this app has a hard dependency on D1 being
up. Confirm with Cloudflare support if the platform status page doesn't
explain it.

## Cron not running / failing

1. `GET /api/admin/cron-runs` as an administrator. Look at `startedAt` on
   the newest row — if it's not from within the last ~25 hours (the job
   runs daily at 03:00 UTC, `wrangler.jsonc`'s `triggers.crons`), the
   trigger itself isn't firing; check the Cloudflare dashboard's Cron
   Triggers tab for the Worker.
2. If it IS running but `status: "failed"`, read `errorMessage` on that
   row. The known, expected failure mode in any sandboxed/restricted
   network environment is UN Comtrade/World Bank being unreachable (see
   `docs/AUDIT.md`'s notes on this) — in real Cloudflare Workers
   production, egress is unrestricted, so a failure there in production
   is a genuine upstream-API problem (rate limit, outage, or a changed
   API shape), not a network policy issue.
3. This job only refreshes a *cache* (`intelligence_watchlist` /
   `trade_intelligence_snapshots`) — a failed run does not corrupt data,
   it just means cached trade-intelligence answers go stale past their
   normal freshness window. Not an emergency; fix and let the next daily
   run catch up (the batch size is intentionally small — see
   `worker/index.ts` — so it self-heals over a few days even after an
   extended outage).

## Suspected account compromise / credential stuffing

1. Query `security_events` for the affected email or IP: repeated
   `login_failed` rows followed by a `login_success` is the pattern to
   look for.
2. To force a suspected-compromised account to re-authenticate
   everywhere: there's no dedicated admin action for this yet (a real
   gap — flagged in docs/production-readiness.md); the closest existing
   lever is `revokeAllSessionsForUser` (`lib/auth/session.ts`), currently
   only called from the password-reset flow. An operator would need
   direct D1 access to call the equivalent effect (mark that user's
   `sessions` rows as revoked) until an admin-desk action exists for it.
3. To suspend an account outright: `admin_audit_events`-backed account
   suspension exists at the schema level (`users.status`) but has no
   dedicated admin-desk UI action yet either — direct D1
   `UPDATE users SET status = 'suspended' WHERE email = '...'` is the
   only path today. `resolveSession` already checks `user.status !==
   'active'` on every request, so this takes effect immediately once set
   — no code deploy or cache to worry about.

## Known gaps in this runbook (be honest, not reassuring)

- No paging/alerting is wired to any of the signals above — someone has
  to actively check `/api/health`, `wrangler tail`, or
  `/api/admin/cron-runs`. There is no automated notification on a failed
  cron run, a spike in `login_failed`, or a `database: "error"` health
  check.
- No admin-desk UI yet for the account-suspension or
  force-session-revocation actions described above — both require direct
  database access, which is a real operational risk (slow response
  during an actual incident, and a broader blast radius than a scoped
  admin action would have).
- Database and R2 restore are both real, but neither is a rehearsed,
  timed drill — see docs/DEPLOYMENT.md §9-10 for exactly what is and
  isn't automated.
