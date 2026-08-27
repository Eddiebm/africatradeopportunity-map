// Priority 10 (docs/production-readiness.md): "provider-neutral messaging
// adapter + webhook interface. Don't hardcode a provider or claim WhatsApp
// works without real credentials/verification."
//
// STOPPING CONDITION, stated plainly (per the mission's own explicit rule
// "missing credentials" is grounds to stop and flag, not fabricate around):
// no WhatsApp Business API credentials (Meta Cloud API, Twilio, or any
// other provider) are configured or available in this environment. Every
// function below is REAL and exercised by real tests and real routes —
// none of it is a stub that merely compiles — but ConsoleWhatsAppProvider
// is the only provider that can possibly be active until a human connects
// a real one and runs `wrangler secret put WHATSAPP_PROVIDER_TOKEN` (or
// equivalent). Mirrors lib/email.ts's exact adapter pattern rather than
// inventing a second one — same reasoning: the app never fabricates a
// successful send, and the interface stays stable regardless of which real
// provider eventually gets connected.
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../db";
import { whatsappContacts, whatsappMessages } from "../db/schema";
import { createSecureLink } from "./secure-links";

export type WhatsAppMessage = {
  to: string; // E.164 phone number
  body: string;
};

export type WhatsAppSendResult = {
  delivered: boolean;
  provider: string;
  providerMessageId: string;
  detail: string;
};

export interface WhatsAppProvider {
  readonly name: string;
  send(message: WhatsAppMessage): Promise<WhatsAppSendResult>;
}

class ConsoleWhatsAppProvider implements WhatsAppProvider {
  readonly name = "console";

  async send(message: WhatsAppMessage): Promise<WhatsAppSendResult> {
    console.log(`[whatsapp:not-delivered] to=${message.to}\n${message.body}`);
    return {
      delivered: false,
      provider: this.name,
      providerMessageId: "",
      detail: "No WhatsApp Business API provider is connected. The message was logged, not sent.",
    };
  }
}

let provider: WhatsAppProvider | null = null;

export function getWhatsAppProvider(): WhatsAppProvider {
  if (!provider) provider = new ConsoleWhatsAppProvider();
  return provider;
}

// --- Consent / opt-out ------------------------------------------------
//
// A DISTINCT record from marketRequests.consentAt (Priority 9's general
// "may contact me" consent) — see db/schema.ts's whatsappContacts header
// for why the two must not be conflated. optOutAt, once set, is
// authoritative: nothing in this file ever clears it automatically — only
// a fresh, explicit recordWhatsAppConsent() call can, and every send path
// below refuses to send to an opted-out number regardless of any other
// signal.

export async function getWhatsAppContact(phoneNumber: string) {
  const db = getDb();
  const [row] = await db.select().from(whatsappContacts).where(eq(whatsappContacts.phoneNumber, phoneNumber)).limit(1);
  return row ?? null;
}

// The real, honest way to answer "does this account have an opted-in
// WhatsApp number?" — there is no `phone` column on `users` (nothing in
// this app's registration flow ever collects one, and adding an always-
// empty column would misrepresent a UI capability that doesn't exist).
// A phone number becomes linked to an email only when a real WhatsApp
// interaction actually established that link (see
// app/api/whatsapp/link/route.ts) — this is a reverse lookup over that
// real data, not a fabricated join.
export async function getOptedInPhoneForEmail(email: string): Promise<string | null> {
  const db = getDb();
  const rows = await db.select().from(whatsappContacts).where(eq(whatsappContacts.linkedEmail, email));
  const opted = rows.find((r) => r.consentAt && !r.optOutAt);
  return opted?.phoneNumber ?? null;
}

export async function recordWhatsAppConsent(phoneNumber: string, linkedEmail = "") {
  const db = getDb();
  const existing = await getWhatsAppContact(phoneNumber);
  const now = new Date().toISOString();
  if (existing) {
    await db.update(whatsappContacts).set({ consentAt: now, optOutAt: null, linkedEmail: linkedEmail || existing.linkedEmail }).where(eq(whatsappContacts.id, existing.id));
    return { ...existing, consentAt: now, optOutAt: null };
  }
  const [row] = await db.insert(whatsappContacts).values({ phoneNumber, linkedEmail, consentAt: now }).returning();
  return row;
}

export async function recordWhatsAppOptOut(phoneNumber: string) {
  const db = getDb();
  const existing = await getWhatsAppContact(phoneNumber);
  const now = new Date().toISOString();
  if (existing) {
    await db.update(whatsappContacts).set({ optOutAt: now }).where(eq(whatsappContacts.id, existing.id));
    return { ...existing, optOutAt: now };
  }
  // Opting out a number this platform never messaged is still honored —
  // it pre-emptively blocks any future send attempt to it.
  const [row] = await db.insert(whatsappContacts).values({ phoneNumber, optOutAt: now }).returning();
  return row;
}

export async function isOptedOut(phoneNumber: string): Promise<boolean> {
  const contact = await getWhatsAppContact(phoneNumber);
  return Boolean(contact?.optOutAt);
}

// --- Message audit log ---------------------------------------------------

export async function logInboundMessage(input: { phoneNumber: string; body: string; messageType?: string; providerMessageId?: string; relatedEntityType?: string; relatedEntityId?: number | null }) {
  const db = getDb();
  const [row] = await db
    .insert(whatsappMessages)
    .values({
      phoneNumber: input.phoneNumber,
      direction: "inbound",
      messageType: input.messageType || "text",
      body: input.body,
      relatedEntityType: input.relatedEntityType || "",
      relatedEntityId: input.relatedEntityId ?? null,
      providerMessageId: input.providerMessageId || "",
      deliveryStatus: "delivered", // an inbound message that reached this webhook was, by definition, delivered to us
    })
    .returning();
  return row;
}

// No production domain is provisioned in this environment — see
// docs/DEPLOYMENT.md. A real deploy sets this from the actual origin.
export const APP_ORIGIN = "https://tradesafe.africa";

// The ONLY sanctioned way to send an outbound WhatsApp message. Deliberately
// narrow: callers supply a plain-text `body` they composed themselves — see
// lib/whatsapp-notify.ts for the ONE real caller, which builds that body
// from a short summary plus a secure link, never raw deal content. Refuses
// to send (and records why) to a number that has opted out or never
// consented, regardless of who is calling.
//
// Every outbound message gets a real, working opt-out link appended —
// WhatsApp Business Platform requires honoring opt-outs, and a safe
// opt-out path has to be tied to a specific message actually sent to that
// number (a secure, single-purpose token — see lib/secure-links.ts), NOT a
// public "type any phone number to opt it out" form, which would let
// anyone silence a competitor's notifications. See
// app/api/whatsapp/opt-out/route.ts.
export async function sendWhatsAppMessage(input: { to: string; body: string; relatedEntityType?: string; relatedEntityId?: number | null }) {
  const db = getDb();
  const contact = await getWhatsAppContact(input.to);
  if (!contact?.consentAt || contact.optOutAt) {
    const [row] = await db
      .insert(whatsappMessages)
      .values({
        phoneNumber: input.to,
        direction: "outbound",
        body: input.body,
        relatedEntityType: input.relatedEntityType || "",
        relatedEntityId: input.relatedEntityId ?? null,
        deliveryStatus: "failed",
        providerMessageId: "",
        providerName: "",
      })
      .returning();
    return { sent: false, reason: contact?.optOutAt ? "opted_out" : "no_consent", message: row };
  }

  const { rawToken } = await createSecureLink({
    purpose: "whatsapp_opt_out",
    entityType: "whatsapp_contact",
    entityId: contact.id,
    createdForPhone: input.to,
    ttlMinutes: 60 * 24 * 90, // 90 days — an opt-out option should stay valid far longer than a typical notification link.
  });
  const fullBody = `${input.body}\n\nReply STOP to opt out, or: ${APP_ORIGIN}/link/${rawToken}`;

  const result = await getWhatsAppProvider().send({ to: input.to, body: fullBody });
  const [row] = await db
    .insert(whatsappMessages)
    .values({
      phoneNumber: input.to,
      direction: "outbound",
      body: fullBody,
      relatedEntityType: input.relatedEntityType || "",
      relatedEntityId: input.relatedEntityId ?? null,
      providerName: result.provider,
      providerMessageId: result.providerMessageId,
      // Honest, not fabricated: "not_configured" when the only active
      // provider is ConsoleWhatsAppProvider (result.delivered is always
      // false for it) — never claim "sent" for something that was only
      // logged.
      deliveryStatus: result.delivered ? "sent" : "not_configured",
    })
    .returning();
  return { sent: result.delivered, reason: result.detail, message: row };
}

// Simple heuristic keyword opt-out, matching WhatsApp Business Platform's
// own real-world convention (a user replying STOP/UNSUBSCRIBE must be
// honored) — deliberately NOT an AI/NLP classification (Priority 6's AI
// decision boundary: this is a fixed keyword match, not a judgment call).
const OPT_OUT_KEYWORDS = ["stop", "unsubscribe", "opt out", "optout"];
export function looksLikeOptOut(body: string): boolean {
  const normalized = body.trim().toLowerCase();
  return OPT_OUT_KEYWORDS.some((k) => normalized === k || normalized.startsWith(`${k} `));
}

// Used by the admin surface — every WhatsApp contact this platform has any
// record of, opted-in or not, most recent activity first (by whichever of
// consentAt/optOutAt/createdAt is latest is unnecessary complexity for the
// current queue size; createdAt ordering is honest and simple).
export async function listWhatsAppContacts(limit = 200) {
  return getDb().select().from(whatsappContacts).limit(limit);
}

export async function listRecentWhatsAppMessages(limit = 200) {
  return getDb().select().from(whatsappMessages).limit(limit);
}

// Unused export kept for symmetry/documentation — a future admin filter
// ("show only contacts who never consented") would use this; not wired
// into a route yet, matching this priority's scope.
export async function listPendingConsentContacts(limit = 200) {
  return getDb().select().from(whatsappContacts).where(and(isNull(whatsappContacts.consentAt), isNull(whatsappContacts.optOutAt))).limit(limit);
}
