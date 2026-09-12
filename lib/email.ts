// Provider-adapter for outbound email (verification links, password resets,
// notification digests). Mirrors the payment-provider-adapter pattern the
// product requires: the app never fabricates a successful send, and the
// interface is stable regardless of which real provider gets connected.
//
// Launch-prep follow-up (docs/production-readiness.md): the account owner
// picked Resend once the app actually went live. ResendEmailProvider below
// is real (a genuine HTTP call to Resend's API, real success/failure
// reporting) and exercised by real tests — but it only ever activates once
// RESEND_API_KEY is actually set (`wrangler secret put`); until then,
// ConsoleEmailProvider stays the only thing that can run, same
// "never fabricate around a missing credential" rule this app applies
// everywhere else (see lib/whatsapp.ts's identical stopping-condition note).
//
// ConsoleEmailProvider logs the message (visible in `wrangler tail` / the
// dashboard Logs view) instead of sending it, and every route that
// triggers an email must treat that as "the link was generated, delivery
// is not yet live" — never claim delivery happened.
import { env } from "cloudflare:workers";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

export type EmailSendResult = {
  delivered: boolean;
  provider: string;
  detail: string;
};

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";

  async send(message: EmailMessage): Promise<EmailSendResult> {
    console.log(`[email:not-delivered] to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`);
    return {
      delivered: false,
      provider: this.name,
      detail: "No email provider is connected. The message was logged, not sent.",
    };
  }
}

// No real domain is verified on Resend in this environment yet (see
// docs/DEPLOYMENT.md) — `onboarding@resend.dev` is Resend's own sandbox
// sender, which works with a bare API key but can only deliver to the
// address that owns the Resend account, not to arbitrary real users.
// EMAIL_FROM lets an operator override this the moment a real domain is
// verified, without a code change; until then this default is the honest
// ceiling of what an unverified account can actually do.
export const DEFAULT_EMAIL_FROM = "TradeSafe Africa <onboarding@resend.dev>";

// Exported (not just reached through getEmailProvider()) so tests can
// exercise the real HTTP call/response-handling logic directly against a
// mocked fetch, without needing RESEND_API_KEY set in the test worker's
// bindings — see tests/unit/email.test.ts.
export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    let response: Response;
    try {
      response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
        }),
      });
    } catch (err) {
      // Network/DNS failure reaching Resend — honestly report it, never
      // claim delivery happened just because we tried.
      return {
        delivered: false,
        provider: this.name,
        detail: `Could not reach Resend: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      // Resend's most common real-world rejection in an unverified account:
      // sending to anyone other than the account owner's own address. Named
      // explicitly here (rather than left as an opaque HTTP code) so
      // whoever reads this in wrangler tail knows exactly what to fix.
      return {
        delivered: false,
        provider: this.name,
        detail: `Resend rejected the send (HTTP ${response.status}): ${body.slice(0, 500) || "no response body"}`,
      };
    }

    const data = (await response.json().catch(() => ({}) as { id?: string })) as { id?: string };
    return {
      delivered: true,
      provider: this.name,
      detail: data.id ? `Sent via Resend (id=${data.id}).` : "Sent via Resend.",
    };
  }
}

let provider: EmailProvider | null = null;
let lastFingerprint: string | undefined;

export function getEmailProvider(): EmailProvider {
  // Re-check RESEND_API_KEY on every call (not just once, cached forever) —
  // mirrors lib/whatsapp.ts's getWhatsAppProvider(): a secret set mid-
  // incident (or rotated) takes effect on the next request, no redeploy
  // required. Keyed on the key/from values themselves (not just presence)
  // so rotating to a new key, or updating EMAIL_FROM after verifying a
  // domain, also rebuilds the provider instead of reusing a stale closure.
  const apiKey = env.RESEND_API_KEY || "";
  const from = env.EMAIL_FROM || DEFAULT_EMAIL_FROM;
  const fingerprint = `${apiKey}:${from}`;
  if (!provider || lastFingerprint !== fingerprint) {
    provider = apiKey ? new ResendEmailProvider(apiKey, from) : new ConsoleEmailProvider();
    lastFingerprint = fingerprint;
  }
  return provider;
}
