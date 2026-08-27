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
   * Cloudflare Turnstile secret key, used server-side to verify CAPTCHA
   * tokens from public forms (registration, market-request posting). Get a
   * real one at dash.cloudflare.com -> Turnstile. Unset/empty in this
   * environment (no dashboard access yet) — see lib/turnstile.ts for how
   * that is handled (verification is honestly reported as not-checked, and
   * only enforced as a hard rejection in production builds).
   */
  TURNSTILE_SECRET_KEY: string;
  /**
   * Priority 10 (docs/production-readiness.md): a shared secret the
   * inbound WhatsApp webhook (app/api/webhooks/whatsapp/route.ts) checks
   * against a request header before trusting the payload. Unset in this
   * environment — no real WhatsApp Business API provider is connected,
   * so there is no real webhook secret to configure yet. See
   * lib/whatsapp.ts's header for the full stopping-condition note.
   */
  WHATSAPP_WEBHOOK_SECRET: string;
}

declare namespace Cloudflare {
  interface Env {
    SESSION_SECRET: string;
    TURNSTILE_SECRET_KEY: string;
    WHATSAPP_WEBHOOK_SECRET: string;
  }
}
