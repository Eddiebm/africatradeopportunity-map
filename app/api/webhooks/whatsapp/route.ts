import { env } from "cloudflare:workers";
import { getDb } from "../../../../db";
import { marketRequests } from "../../../../db/schema";
import { logInboundMessage, looksLikeOptOut, recordWhatsAppConsent, recordWhatsAppOptOut } from "../../../../lib/whatsapp";

// Priority 10 (docs/production-readiness.md): "Support inbound quote
// requests, structured follow-ups, consent tracking, opt-out, ... audit
// history." A provider-neutral webhook: it accepts a NORMALIZED
// `{from, body, messageId?}` shape, not any specific provider's actual
// payload format (Meta Cloud API, Twilio, and every other WhatsApp
// Business API provider each use a different real JSON structure). A real
// provider integration translates its own webhook payload into this shape
// before calling the logic below — that translation layer does not exist
// yet because no real provider is connected (the mission's own explicit
// "missing credentials" stopping condition, stated plainly here rather
// than faked around).
//
// Signature verification: if WHATSAPP_WEBHOOK_SECRET is configured, a
// request without a matching `x-webhook-secret` header is rejected. If it
// is NOT configured (this environment), the request is still processed —
// documented honestly as "not verified," mirroring lib/turnstile.ts's
// verifyTurnstile()/turnstileEnforced() pattern rather than silently
// pretending every request is authentic.
export async function POST(request: Request) {
  const configuredSecret = env.WHATSAPP_WEBHOOK_SECRET;
  if (configuredSecret) {
    const provided = request.headers.get("x-webhook-secret");
    if (provided !== configuredSecret) {
      return Response.json({ error: "Invalid webhook signature." }, { status: 401 });
    }
  }

  let body: { from?: string; text?: string; messageId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const from = String(body.from || "").trim();
  const text = String(body.text || "").trim();
  if (!from || !text) return Response.json({ error: "A sender number and message text are required." }, { status: 400 });

  // The audit history — logged unconditionally, whether or not this turns
  // into anything else, and regardless of consent/opt-out state (a message
  // this platform actually received is a real event that happened,
  // separate from whether this platform is allowed to reply).
  await logInboundMessage({ phoneNumber: from, body: text, providerMessageId: body.messageId || "" });

  if (looksLikeOptOut(text)) {
    await recordWhatsAppOptOut(from);
    return Response.json({ ok: true, action: "opted_out" });
  }

  // An inbound, user-initiated message is WhatsApp Business Platform's own
  // real-world convention for consent to reply within the messaging
  // window — recorded here as a real consent fact, not assumed silently;
  // see db/schema.ts's whatsappContacts header.
  await recordWhatsAppConsent(from);

  // "Support inbound quote requests" — the raw message text becomes the
  // `product` field of a real marketRequests row (role:"quote_request",
  // same table and role Priority 9's /quote page uses), exactly as
  // typed. This is deliberately NOT structured NLP/parsing of the
  // message into product/quantity/destination — guessing at those from
  // free text would be fabricating structured data from an unstructured
  // signal, which this platform's own rules forbid. A human reviewer on
  // the admin desk's Listings tab reads the raw text and follows up,
  // exactly like the low-friction /quote submissions they already review.
  const [row] = await getDb()
    .insert(marketRequests)
    .values({
      role: "quote_request",
      product: text,
      destination: "",
      origin: "",
      volume: "",
      contact: from,
      preferredContactMethod: "whatsapp",
      consentAt: new Date().toISOString(),
    })
    .returning({ id: marketRequests.id });

  return Response.json({ ok: true, action: "quote_request_created", requestId: row.id });
}
