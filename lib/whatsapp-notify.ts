// Priority 10 (docs/production-readiness.md): the ONE real caller of
// lib/whatsapp.ts's sendWhatsAppMessage for a real platform event —
// "milestone notifications," explicitly named in the mission's field
// list. Deliberately narrow on purpose: this function's signature only
// accepts a short, structured summary — there is no code path here that
// can forward raw deal content, evidence, or documents into a WhatsApp
// message body. The secure link (lib/secure-links.ts) is how a recipient
// actually sees anything sensitive, behind this platform's real login.
import { createSecureLink } from "./secure-links";
import { sendWhatsAppMessage, getOptedInPhoneForEmail, APP_ORIGIN } from "./whatsapp";

export async function notifyMilestoneEventByWhatsApp(input: {
  dealId: number;
  dealReference: string;
  milestoneName: string;
  summary: string; // e.g. "evidence verified", "evidence sent back" — never a document name or content.
  ownerEmail: string;
}) {
  const phoneNumber = await getOptedInPhoneForEmail(input.ownerEmail);
  if (!phoneNumber) return { sent: false, reason: "no_opted_in_number" as const };

  const { rawToken } = await createSecureLink({
    purpose: "milestone_notification",
    entityType: "deal",
    entityId: input.dealId,
    createdForPhone: phoneNumber,
  });

  const body = `TradeSafe Africa: milestone "${input.milestoneName}" on deal ${input.dealReference} — ${input.summary}. View the details securely: ${APP_ORIGIN}/link/${rawToken}`;

  return sendWhatsAppMessage({
    to: phoneNumber,
    body,
    relatedEntityType: "deal",
    relatedEntityId: input.dealId,
  });
}
