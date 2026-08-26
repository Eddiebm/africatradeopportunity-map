// Provider-adapter for outbound email (verification links, password resets,
// notification digests). Mirrors the payment-provider-adapter pattern the
// product requires: the app never fabricates a successful send, and the
// interface is stable regardless of which real provider gets connected.
//
// No email provider is connected yet. ConsoleEmailProvider logs the message
// (visible in `wrangler tail` / the dashboard Logs view) instead of sending
// it, and every route that triggers an email must treat that as "the link
// was generated, delivery is not yet live" — never claim delivery happened.
//
// To connect a real provider (e.g. Resend, Postmark, SES): implement
// EmailProvider, set the provider's API key with `wrangler secret put`, and
// swap the provider returned from getEmailProvider() below.

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
    // eslint-disable-next-line no-console
    console.log(`[email:not-delivered] to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`);
    return {
      delivered: false,
      provider: this.name,
      detail: "No email provider is connected. The message was logged, not sent.",
    };
  }
}

let provider: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (!provider) provider = new ConsoleEmailProvider();
  return provider;
}
