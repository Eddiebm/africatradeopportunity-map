// Priority 11 (docs/production-readiness.md): "Brokers, associations,
// referrals." See db/schema.ts's header comment above referralPartners
// for the full data-model rationale (money-movement boundary, protected
// first-attribution-wins, why code creation isn't role-gated).
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { organizationMembers, organizations, referralAttributions, referralPartners, users, type ReferralAttributionSource } from "../db/schema";

function generateCode(): string {
  // Short and shareable (fits in a URL/WhatsApp message cleanly), not a
  // cryptographic secret — a referral code identifies WHO gets credit for
  // an introduction, not a security boundary (see resolveReferralPartner:
  // it only ever returns a public organization name, nothing sensitive).
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I — avoids transcription ambiguity when read aloud or handwritten
  let code = "";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const b of bytes) code += alphabet[b % alphabet.length];
  return code;
}

export async function createReferralCode(organizationId: number, createdByEmail: string) {
  const db = getDb();
  // Collision odds are astronomically low (32^6) but checked anyway,
  // rather than relying on the unique index alone to fail loudly —
  // retries a handful of times before giving up honestly.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const [existing] = await db.select({ id: referralPartners.id }).from(referralPartners).where(eq(referralPartners.code, code)).limit(1);
    if (existing) continue;
    const [row] = await db.insert(referralPartners).values({ organizationId, code, createdByEmail }).returning();
    return row;
  }
  throw new Error("Could not generate a unique referral code — please try again.");
}

export async function listReferralCodesForOrganization(organizationId: number) {
  return getDb().select().from(referralPartners).where(eq(referralPartners.organizationId, organizationId));
}

/** Public lookup — returns ONLY the referring organization's public name,
 * never contact details, commission terms, or any deal information. This
 * is the entire "never reveal private deal details through referral
 * links" guarantee for the resolve step: there is structurally nothing
 * private in the return type. */
export async function resolveReferralPartner(code: string): Promise<{ organizationName: string; status: string } | null> {
  const db = getDb();
  const [partner] = await db.select().from(referralPartners).where(eq(referralPartners.code, code.trim().toUpperCase())).limit(1);
  if (!partner) return null;
  const [org] = await db.select({ legalName: organizations.legalName }).from(organizations).where(eq(organizations.id, partner.organizationId)).limit(1);
  return { organizationName: org?.legalName || "A TradeSafe Africa partner", status: partner.status };
}

// Self-referral means the referee IS, in some real sense, the referring
// organization — either they own it outright, or they're a real active
// member of it. Both checked against real rows, never inferred from a
// name/domain match (which would be a guess, not a fact).
async function isSelfReferral(referralPartnerOrgId: number, refereeContact: string): Promise<boolean> {
  const db = getDb();
  const [org] = await db.select({ ownerEmail: organizations.ownerEmail }).from(organizations).where(eq(organizations.id, referralPartnerOrgId)).limit(1);
  if (org?.ownerEmail === refereeContact) return true;

  const [refereeUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, refereeContact)).limit(1);
  if (!refereeUser) return false; // an anonymous/unregistered referee can't be an existing member of anything
  const [membership] = await db
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, referralPartnerOrgId), eq(organizationMembers.userId, refereeUser.id), eq(organizationMembers.status, "active")))
    .limit(1);
  return Boolean(membership);
}

/**
 * The ONLY writer of referralAttributions. Real fraud/self-referral
 * checks run before anything is trusted:
 *  - a code that doesn't exist, or belongs to a suspended partner, is
 *    silently a no-op (returns null) — never an error surfaced to the
 *    referred visitor, who did nothing wrong.
 *  - self-referral: the referee IS the referring organization's owner.
 *  - duplicate: this referee already has a PRIMARY attribution from a
 *    different code — the first one keeps it (see db/schema.ts header).
 */
export async function recordReferralAttribution(input: {
  code: string;
  refereeContact: string;
  marketRequestId?: number | null;
  dealId?: number | null;
  source: ReferralAttributionSource;
}) {
  if (!input.refereeContact) return null;
  const db = getDb();
  const [partner] = await db.select().from(referralPartners).where(eq(referralPartners.code, input.code.trim().toUpperCase())).limit(1);
  if (!partner || partner.status !== "active") return null;

  const selfReferral = await isSelfReferral(partner.organizationId, input.refereeContact);

  const existingPrimary = await db
    .select({ id: referralAttributions.id })
    .from(referralAttributions)
    .where(and(eq(referralAttributions.refereeContact, input.refereeContact), eq(referralAttributions.isPrimary, true)))
    .limit(1);
  const isDuplicate = existingPrimary.length > 0;

  const [row] = await db
    .insert(referralAttributions)
    .values({
      referralCode: partner.code,
      referralPartnerId: partner.id,
      refereeContact: input.refereeContact,
      marketRequestId: input.marketRequestId ?? null,
      dealId: input.dealId ?? null,
      source: input.source,
      isPrimary: !selfReferral && !isDuplicate,
      fraudFlag: selfReferral ? "self_referral" : isDuplicate ? "duplicate_attribution" : "",
    })
    .returning();
  return row;
}
