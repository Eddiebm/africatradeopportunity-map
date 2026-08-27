// Priority 6 (docs/production-readiness.md): "Implement transparent
// verification levels" + "Create a rules engine that recommends the
// required verification level." See db/schema.ts's organizationVerifications
// table header for the data model this reads/writes.
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { organizationVerifications, VERIFICATION_LEVELS, type VerificationLevelKey } from "../db/schema";
import type { CorridorTier } from "./corridor-templates";

/**
 * An organization's CURRENT level is the highest N such that levels
 * 1..N ALL have at least one 'passed', not-expired, human-reviewed row —
 * a progression, not independent badges. A gap at level 3 caps the
 * organization at level 2 even if level 5 has a passed row sitting in
 * the table — that row just doesn't count toward anything until the gap
 * is closed, matching "verification levels" as a real progression rather
 * than a checklist of unrelated facts.
 */
export async function resolveOrganizationVerificationLevel(organizationId: number): Promise<{ level: number; achievedKeys: VerificationLevelKey[] }> {
  const db = getDb();
  const rows = await db.select().from(organizationVerifications).where(eq(organizationVerifications.organizationId, organizationId));

  const now = Date.now();
  const passedKeys = new Set(
    rows
      .filter((r) => r.result === "passed" && !r.humanReviewRequired && (!r.expiresAt || new Date(r.expiresAt).getTime() > now))
      .map((r) => r.levelKey),
  );

  let level = 0;
  const achievedKeys: VerificationLevelKey[] = [];
  for (const key of VERIFICATION_LEVELS) {
    if (!passedKeys.has(key)) break;
    level += 1;
    achievedKeys.push(key);
  }
  return { level, achievedKeys };
}

/**
 * Records ONE verification fact. Append-only — never call this to
 * "update" an existing row; a re-check (evidence expired, a re-review)
 * is a new row, preserving the full history (see this table's header
 * comment in db/schema.ts). humanReviewRequired defaults true — an
 * AI-assisted extraction/flag (Priority 6's explicit AI boundary) is
 * never allowed to set this false; only a human reviewer confirming the
 * result themselves does (enforced in
 * app/api/admin/organization-verifications/route.ts, not just here).
 */
export async function recordOrganizationVerification(input: {
  organizationId: number;
  levelKey: VerificationLevelKey;
  whatWasChecked: string;
  performedByEmail: string;
  evidenceFileId?: number | null;
  source: string;
  result: "pending" | "passed" | "failed";
  reviewerEmail: string;
  notes?: string;
  humanReviewRequired: boolean;
  expiresAt?: string | null;
}) {
  const db = getDb();
  const [row] = await db
    .insert(organizationVerifications)
    .values({
      organizationId: input.organizationId,
      levelKey: input.levelKey,
      whatWasChecked: input.whatWasChecked,
      performedByEmail: input.performedByEmail,
      evidenceFileId: input.evidenceFileId ?? null,
      source: input.source,
      checkedAt: new Date().toISOString(),
      expiresAt: input.expiresAt ?? null,
      result: input.result,
      reviewerEmail: input.reviewerEmail,
      notes: input.notes ?? "",
      humanReviewRequired: input.humanReviewRequired,
    })
    .returning();
  return row;
}

export async function getVerificationHistory(organizationId: number) {
  return getDb()
    .select()
    .from(organizationVerifications)
    .where(and(eq(organizationVerifications.organizationId, organizationId)));
}

// --- Rules engine ------------------------------------------------------
//
// Per docs/AUDIT.md's AI boundary: this RECOMMENDS a level; nothing calls
// it to auto-approve, auto-verify, or block a transaction. It is a
// decision-support signal for a human (a trader deciding how much
// diligence to do, an analyst deciding how hard to push) — never a gate
// enforced by this code. The thresholds below are THIS PLATFORM'S OWN
// risk policy, chosen as a reasonable illustrative default — they are
// not sourced from any external regulatory requirement, and the
// breakdown says so explicitly rather than implying authority it doesn't
// have (the same "never fabricate" ethic as everywhere else in this app).

export type ProductRisk = "low" | "medium" | "high";
export type PaymentTerms = "advance" | "letter_of_credit" | "net_terms" | "on_delivery";
export type EvidenceQuality = "low" | "medium" | "high";

export interface VerificationLevelRecommendationInput {
  transactionValueUsd: number;
  corridorTier: CorridorTier;
  productRisk: ProductRisk;
  isFirstTimeRelationship: boolean;
  priorDisputeCount: number;
  paymentTerms: PaymentTerms;
  evidenceQuality: EvidenceQuality;
}

export interface VerificationLevelRecommendation {
  recommendedLevel: number; // 1-6
  breakdown: { factor: string; levelsAdded: number; reason: string }[];
  policyNote: string;
}

export function recommendVerificationLevel(input: VerificationLevelRecommendationInput): VerificationLevelRecommendation {
  const breakdown: VerificationLevelRecommendation["breakdown"] = [
    { factor: "baseline", levelsAdded: 1, reason: "Every transaction needs at least identity verification (level 1)." },
  ];

  if (input.transactionValueUsd >= 250_000) {
    breakdown.push({ factor: "transaction_value", levelsAdded: 2, reason: `Transaction value $${input.transactionValueUsd.toLocaleString()} is large — this platform's policy escalates high-value deals two levels.` });
  } else if (input.transactionValueUsd >= 50_000) {
    breakdown.push({ factor: "transaction_value", levelsAdded: 1, reason: `Transaction value $${input.transactionValueUsd.toLocaleString()} exceeds this platform's $50,000 caution threshold.` });
  }

  if (input.corridorTier === "intelligence") {
    breakdown.push({ factor: "corridor_tier", levelsAdded: 1, reason: "This corridor has no operationally reviewed template yet — less institutional knowledge means more individual diligence." });
  }

  if (input.productRisk === "high") {
    breakdown.push({ factor: "product_risk", levelsAdded: 1, reason: "Product flagged high-risk (e.g. regulated, perishable, high-value-density, or commonly misdeclared)." });
  }

  if (input.isFirstTimeRelationship) {
    breakdown.push({ factor: "first_time_relationship", levelsAdded: 1, reason: "No prior successful transaction history between these parties." });
  }

  if (input.priorDisputeCount > 0) {
    const levelsAdded = Math.min(input.priorDisputeCount, 2);
    breakdown.push({ factor: "prior_disputes", levelsAdded, reason: `${input.priorDisputeCount} prior dispute(s) involving one or both parties.` });
  }

  if (input.paymentTerms === "advance") {
    breakdown.push({ factor: "payment_terms", levelsAdded: 1, reason: "Advance payment before delivery is the highest-exposure payment structure." });
  }

  if (input.evidenceQuality === "low") {
    breakdown.push({ factor: "evidence_quality", levelsAdded: 1, reason: "Evidence submitted so far is thin or low-confidence." });
  }

  const recommendedLevel = Math.min(6, breakdown.reduce((sum, b) => sum + b.levelsAdded, 0));

  return {
    recommendedLevel,
    breakdown,
    policyNote:
      "This is TradeSafe Africa's own risk policy, not a regulatory or legal requirement, and not a decision — it recommends a diligence level for a human to consider. AI-assisted evidence review may inform this signal but never finalizes a verification result (see organization_verifications.humanReviewRequired).",
  };
}
