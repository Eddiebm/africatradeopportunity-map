// Ambient declaration for secrets and vars that are NOT declared in
// wrangler.jsonc (bindings like DB/BUCKET are typed by the generated
// worker-configuration.d.ts — regenerate it with `npm run cf-typegen`
// after editing wrangler.jsonc).
//
// These values are set via `wrangler secret put <NAME>` in every real
// environment, and via a local, gitignored `.dev.vars` file for `vinext dev`
// / `wrangler dev`. See .dev.vars.example for the full list and
// docs/DEPLOYMENT.md for how to generate and set each one.
//
// This file has no imports/exports, so both declarations merge into the
// ambient types worker-configuration.d.ts generates: the top-level `Env`
// (the Worker fetch handler's `env` parameter type) and `Cloudflare.Env`
// (what `import { env } from "cloudflare:workers"` is typed as — the form
// almost all app code uses).
interface Env {
  /** HMAC key (32+ random bytes, base64) signing the session cookie. */
  SESSION_SECRET: string;
  /**
   * Cloudflare Turnstile secret. Spin's name is TURNSTILE_SECRET; this
   * Worker already stores the dashboard widget secret as
   * TURNSTILE_SECRET_KEY. lib/turnstile.ts accepts either.
   */
  TURNSTILE_SECRET?: string;
  TURNSTILE_SECRET_KEY: string;
  /**
   * Comma-separated frontend hostnames siteverify must match. Production
   * value is wrangler.jsonc `vars.TURNSTILE_HOSTNAMES` and must not include
   * localhost.
   */
  TURNSTILE_HOSTNAMES: string;
  /**
   * Priority 10 (docs/production-readiness.md): a shared secret the
   * inbound WhatsApp webhook (app/api/webhooks/whatsapp/route.ts) checks
   * against a request header before trusting the payload. Unset in this
   * environment — no real WhatsApp Business API provider is connected,
   * so there is no real webhook secret to configure yet. See
   * lib/whatsapp.ts's header for the full stopping-condition note.
   */
  WHATSAPP_WEBHOOK_SECRET: string;
  /**
   * Production-hardening audit follow-up (Phase 6 — release safety): a
   * kill switch for real outbound WhatsApp sends, checked in
   * lib/whatsapp.ts's getWhatsAppProvider(). No real provider is wired in
   * today (see lib/whatsapp.ts's own stopping-condition note) so this has
   * no effect yet — it exists so that whenever a real provider IS
   * connected later, there is already a way to stop real sends
   * immediately (set to exactly "false") without a redeploy, mirroring
   * turnstileEnforced()'s honest fail-open/fail-closed pattern above.
   * Unset (default) means enabled.
   */
  WHATSAPP_SENDS_ENABLED: string;
  /**
   * Launch-prep (docs/production-readiness.md): Resend API key, checked in
   * lib/email.ts's getEmailProvider(). Unset means ConsoleEmailProvider
   * stays active (messages logged, not sent) — same honest,
   * never-fabricate-around-a-missing-credential rule as every other
   * provider adapter in this app. Set via `wrangler secret put
   * RESEND_API_KEY` once the account owner has a real Resend account.
   */
  RESEND_API_KEY: string;
  /**
   * Launch-prep (docs/production-readiness.md): the verified "From" address
   * Resend sends as, e.g. `TradeSafe Africa <notifications@tradesafe.africa>`.
   * Unset falls back to Resend's own sandbox sender
   * (`onboarding@resend.dev`), which only delivers to the Resend account
   * owner's own address — set this to a real address on a domain verified
   * in the Resend dashboard before expecting delivery to real users. See
   * lib/email.ts's DEFAULT_EMAIL_FROM.
   */
  EMAIL_FROM: string;
}

declare namespace Cloudflare {
  interface Env {
    SESSION_SECRET: string;
    TURNSTILE_SECRET?: string;
    TURNSTILE_SECRET_KEY: string;
    TURNSTILE_HOSTNAMES: string;
    WHATSAPP_WEBHOOK_SECRET: string;
    WHATSAPP_SENDS_ENABLED: string;
    RESEND_API_KEY: string;
    EMAIL_FROM: string;
  }
}
