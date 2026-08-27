// Priority 5 (docs/production-readiness.md): "Create explicit
// distinctions between: Intelligence coverage / Operationally supported
// corridors / TradeSafe Verified corridors." See db/schema.ts's
// corridorTemplates table header for the data model and versioning
// rules this module operates on.
import { desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { corridorTemplates, type CorridorTemplateStatus } from "../db/schema";

export type CorridorTier = "intelligence" | "operational" | "verified";
export type CorridorTemplateRow = typeof corridorTemplates.$inferSelect;

export function corridorKeyFor(origin: string, destination: string): string {
  // Deliberately just the two country names joined, not a code lookup —
  // this app's country list (see app/page.tsx's `cs`) already uses full
  // names consistently everywhere else (deals.origin/destination,
  // dealParties, etc.), so matching that convention here avoids a second
  // parallel country-code system just for this table.
  return `${origin.trim()}::${destination.trim()}`;
}

/**
 * The current (highest-version) template row for a corridor, or null if
 * none exists yet — a corridor with no row at all is "intelligence
 * coverage only," not an error.
 */
export async function getCurrentTemplate(corridorKey: string): Promise<CorridorTemplateRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(corridorTemplates)
    .where(eq(corridorTemplates.corridorKey, corridorKey))
    .orderBy(desc(corridorTemplates.version))
    .limit(1);
  return row ?? null;
}

/**
 * Resolves which of the three tiers a corridor is in right now.
 * 'verified' requires the CURRENT version specifically to be
 * status:'operational' — an older, since-superseded operational version
 * does not count; only the latest version's status reflects where the
 * corridor stands today. A 'suspended' current version is deliberately
 * NOT 'verified' — see CORRIDOR_TEMPLATE_STATUSES's header comment.
 */
export async function resolveCorridorTier(origin: string, destination: string): Promise<{ tier: CorridorTier; template: CorridorTemplateRow | null }> {
  const template = await getCurrentTemplate(corridorKeyFor(origin, destination));
  if (!template) return { tier: "intelligence", template: null };
  if (template.status === "operational") return { tier: "verified", template };
  return { tier: "operational", template };
}

/**
 * Creates a new version for a corridor — never mutates an existing row
 * (see db/schema.ts's IMMUTABLE VERSIONING comment). version is the
 * previous current version + 1, or 1 for a brand-new corridorKey.
 */
export async function createCorridorTemplateVersion(input: {
  corridorKey: string;
  origin: string;
  destination: string;
  productCategoriesJson: string;
  requiredBuyerInfo: string;
  requiredSupplierInfo: string;
  requiredDocumentsJson: string;
  verificationRequirements: string;
  standardMilestonesJson: string;
  evidenceRequiredJson: string;
  approvedPartnerRolesJson: string;
  expectedTiming: string;
  costComponentsJson: string;
  riskRules: string;
  escalationRules: string;
  sourceAttribution: string;
  reviewerEmail: string;
  confidence: string;
  status: CorridorTemplateStatus;
  createdByEmail: string;
}) {
  const db = getDb();
  const existing = await getCurrentTemplate(input.corridorKey);
  const version = (existing?.version ?? 0) + 1;
  const [row] = await db
    .insert(corridorTemplates)
    .values({
      ...input,
      version,
      lastReviewedAt: input.status === "draft" ? null : new Date().toISOString(),
    })
    .returning();
  return row;
}
