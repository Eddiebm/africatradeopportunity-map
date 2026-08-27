import { requireUserOrResponse } from "../../../../lib/auth/current-user";
import { recordWhatsAppConsent, getOptedInPhoneForEmail } from "../../../../lib/whatsapp";

// Priority 10 (docs/production-readiness.md): the real, honest way an
// account gets an opted-in WhatsApp number on file — a signed-in user
// explicitly linking one, not a phone-number field silently added to
// registration nobody asked to collect. This is what
// lib/whatsapp-notify.ts's getOptedInPhoneForEmail lookup actually reads.
// A minimal E.164 shape check only — no real number-verification
// (an SMS/WhatsApp OTP flow) exists in this environment, since that also
// requires a real provider; documented as a limitation, not hidden.
const E164 = /^\+[1-9]\d{6,14}$/;

export async function POST(request: Request) {
  const auth = await requireUserOrResponse(request);
  if (auth instanceof Response) return auth;
  const user = auth;

  let body: { phoneNumber?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const phoneNumber = String(body.phoneNumber || "").trim();
  if (!E164.test(phoneNumber)) {
    return Response.json({ error: "Enter a phone number in international format, e.g. +233123456789." }, { status: 400 });
  }

  await recordWhatsAppConsent(phoneNumber, user.email);
  return Response.json({ ok: true, phoneNumber });
}

export async function GET(request: Request) {
  const auth = await requireUserOrResponse(request);
  if (auth instanceof Response) return auth;
  const user = auth;
  const phoneNumber = await getOptedInPhoneForEmail(user.email);
  return Response.json({ phoneNumber });
}
