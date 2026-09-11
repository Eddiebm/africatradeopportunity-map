import { redirect } from "next/navigation";
import { resolveSecureLink } from "../../../lib/secure-links";
import { recordWhatsAppOptOut } from "../../../lib/whatsapp";
import { getDb } from "../../../db";
import { whatsappContacts } from "../../../db/schema";
import { eq } from "drizzle-orm";

// Priority 10 (docs/production-readiness.md): the landing point for every
// "secure expiring link" this platform ever sends via WhatsApp (see
// lib/secure-links.ts's header for the full rationale). Two purposes are
// wired here:
//  - Anything deal-related (currently "milestone_notification"): resolves
//    the token, then hands off to the REAL, already auth-gated `/deal/:id`
//    page via redirect() — this component never itself renders deal
//    content, so it can never leak anything the real page's own
//    Priority 1 authorization wouldn't already allow. A signed-out or
//    unauthorized visitor still hits that page's own login/404 handling
//    exactly as if they'd typed the URL directly.
//  - "whatsapp_opt_out": performs the opt-out directly (safe specifically
//    BECAUSE it's gated by a high-entropy, single-purpose token tied to a
//    message this platform actually sent to that number — see
//    lib/whatsapp.ts's sendWhatsAppMessage for why this is not a public
//    "type any phone number" form).
export default async function SecureLink({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await resolveSecureLink(token);

  if (!resolved.ok) {
    return (
      <main className="quotepage">
        <header>
          <div><b>TradeSafe Africa</b></div>
          <a href="/">Home</a>
        </header>
        <section className="quoteconfirm">
          <h2>{resolved.reason === "expired" ? "This link has expired." : "This link is not valid."}</h2>
          <p>
            {resolved.reason === "expired"
              ? "For your security, links sent by TradeSafe Africa only stay active for a limited time. Sign in to your account to see the latest status directly."
              : "This link could not be recognized. If you followed a link from a TradeSafe Africa message, please check it was copied correctly."}
          </p>
          <a href="/login">Sign in</a>
          <a className="secondary" href="/">Continue browsing</a>
        </section>
      </main>
    );
  }

  if (resolved.purpose === "whatsapp_opt_out" && resolved.entityType === "whatsapp_contact") {
    const [contact] = await getDb().select().from(whatsappContacts).where(eq(whatsappContacts.id, resolved.entityId)).limit(1);
    if (contact) await recordWhatsAppOptOut(contact.phoneNumber);
    return (
      <main className="quotepage">
        <header>
          <div><b>TradeSafe Africa</b></div>
          <a href="/">Home</a>
        </header>
        <section className="quoteconfirm">
          <h2>You have been opted out of WhatsApp messages.</h2>
          <p>
            TradeSafe Africa will no longer send WhatsApp messages to this number. You can still track your deals
            and requests by email or by signing in to your account.
          </p>
          <a href="/">Continue to TradeSafe Africa</a>
        </section>
      </main>
    );
  }

  if (resolved.entityType === "deal") {
    redirect(`/deal/${resolved.entityId}`);
  }

  // No other entity type is wired to a real destination yet — fail
  // honestly rather than guess a URL.
  redirect("/dashboard");
}
