// Priority 12 (docs/production-readiness.md): landed-cost accuracy. See
// db/schema.ts's landedCostEntries header for the full data-model
// rationale. This module is the ONLY place that turns raw entry rows into
// a breakdown a page can render — one code path, so "what counts as the
// current estimate for a component" is answered exactly once, not
// re-derived slightly differently in every caller.
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { landedCostEntries, LANDED_COST_COMPONENT_TYPES, type LandedCostComponentType } from "../db/schema";

export async function recordLandedCostEntry(input: {
  dealId: number;
  componentType: LandedCostComponentType;
  phase: "estimate" | "actual";
  lowAmount?: number | null;
  expectedAmount: number;
  highAmount?: number | null;
  currency?: string;
  source?: string;
  sourceDate?: string | null;
  confidence?: "low" | "medium" | "high";
  assumptions?: string;
  isExcluded?: boolean;
  recordedByEmail: string;
}) {
  const [row] = await getDb()
    .insert(landedCostEntries)
    .values({
      dealId: input.dealId,
      componentType: input.componentType,
      phase: input.phase,
      lowAmount: input.lowAmount ?? null,
      expectedAmount: input.expectedAmount,
      highAmount: input.highAmount ?? null,
      currency: input.currency || "USD",
      source: input.source || "",
      sourceDate: input.sourceDate ?? null,
      confidence: input.confidence || "low",
      assumptions: input.assumptions || "",
      isExcluded: input.isExcluded ?? false,
      recordedByEmail: input.recordedByEmail,
    })
    .returning();
  return row;
}

export interface LandedCostComponentBreakdown {
  componentType: LandedCostComponentType;
  estimate: typeof landedCostEntries.$inferSelect | null;
  actual: typeof landedCostEntries.$inferSelect | null;
  // actual.expectedAmount - estimate.expectedAmount — null until both
  // exist. A negative variance means the actual cost came in UNDER the
  // estimate; this is never phrased as "savings" or "profit" anywhere
  // this function's output is rendered (see app/deal/[id]/page.tsx) —
  // those are commercial claims this platform cannot make on a trader's
  // behalf (see this priority's own "never show ... unsupported profit
  // claims" rule).
  variance: number | null;
}

export interface LandedCostBreakdown {
  components: LandedCostComponentBreakdown[];
  excluded: (typeof landedCostEntries.$inferSelect)[];
  totals: { low: number | null; expected: number; high: number | null };
  actualTotal: number | null; // only set once EVERY non-excluded component has a recorded actual
  overallConfidence: "low" | "medium" | "high" | "mixed" | null;
}

/**
 * "Latest wins" per (componentType, phase) — same append-only-history-but-
 * current-fact-is-the-newest-row convention as
 * lib/verification-levels.ts's resolveOrganizationVerificationLevel and
 * lib/exceptions.ts's latestOrgVerificationFacts. A component with no
 * estimate on file at all is simply absent from `components` — never
 * synthesized as $0, which would misreport it as "known to cost
 * nothing" rather than "not yet estimated."
 */
export async function getLandedCostBreakdown(dealId: number): Promise<LandedCostBreakdown> {
  const rows = await getDb().select().from(landedCostEntries).where(eq(landedCostEntries.dealId, dealId));

  const latestByKey = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    const key = `${row.componentType}:${row.phase}`;
    const current = latestByKey.get(key);
    if (!current || row.id > current.id) latestByKey.set(key, row);
  }

  const components: LandedCostComponentBreakdown[] = [];
  const excluded: (typeof landedCostEntries.$inferSelect)[] = [];
  let low = 0, expected = 0, high = 0;
  let hasLow = true, hasHigh = true;
  let actualTotal = 0;
  let allHaveActuals = true;
  let anyComponent = false;
  const confidences = new Set<string>();

  for (const componentType of LANDED_COST_COMPONENT_TYPES) {
    const estimate = latestByKey.get(`${componentType}:estimate`) ?? null;
    const actual = latestByKey.get(`${componentType}:actual`) ?? null;
    if (!estimate && !actual) continue;

    if (estimate?.isExcluded) {
      excluded.push(estimate);
      continue; // excluded components never enter the totals
    }

    anyComponent = true;
    const variance = actual && estimate ? actual.expectedAmount - estimate.expectedAmount : null;
    components.push({ componentType, estimate, actual, variance });

    if (estimate) {
      expected += estimate.expectedAmount;
      if (estimate.lowAmount != null) low += estimate.lowAmount; else hasLow = false;
      if (estimate.highAmount != null) high += estimate.highAmount; else hasHigh = false;
      confidences.add(estimate.confidence);
    }
    if (actual) actualTotal += actual.expectedAmount;
    else allHaveActuals = false;
  }

  const overallConfidence = confidences.size === 0 ? null : confidences.size > 1 ? "mixed" : ([...confidences][0] as "low" | "medium" | "high");

  return {
    components,
    excluded,
    totals: { low: hasLow ? low : null, expected, high: hasHigh ? high : null },
    actualTotal: anyComponent && allHaveActuals ? actualTotal : null,
    overallConfidence,
  };
}

/**
 * Deal-creation seeding — see app/api/deals/route.ts. Maps the SAME
 * numbers the intake form already collects (goods/transport/insurance/
 * duties/inspection/financing) into real, sourced estimate rows, AND adds
 * the two components that form has never asked for at all
 * (brokerage, tradesafe_fees) — see this function's own field-by-field
 * comments for exactly what's honest to claim about each.
 */
export async function seedLandedCostFromDealIntake(input: {
  dealId: number;
  currency: string;
  recordedByEmail: string;
  supplierCost: number;
  freight: number;
  borderTaxes: number;
  financeFx: number;
  // These three genuinely are NOT collected by app/deal/new/page.tsx's
  // form today (confirmed by inspection before writing this, not
  // assumed) — always 0 via db/schema.ts's dealCosts column defaults,
  // which silently reads as "known to cost nothing." Seeded here as
  // EXCLUDED instead, so the breakdown honestly says "not yet
  // estimated" rather than implying a verified $0.
  insuranceCollected: boolean;
  inspectionCollected: boolean;
  insurance: number;
  inspection: number;
}) {
  const now = new Date().toISOString().slice(0, 10);
  const base = {
    dealId: input.dealId,
    phase: "estimate" as const,
    currency: input.currency,
    recordedByEmail: input.recordedByEmail,
    sourceDate: now,
  };
  await Promise.all([
    recordLandedCostEntry({ ...base, componentType: "goods", expectedAmount: input.supplierCost, confidence: "low", source: "Trader-reported at deal creation" }),
    recordLandedCostEntry({ ...base, componentType: "transport", expectedAmount: input.freight, confidence: "low", source: "Trader-reported at deal creation" }),
    recordLandedCostEntry({ ...base, componentType: "duties_taxes", expectedAmount: input.borderTaxes, confidence: "low", source: "Trader-reported at deal creation" }),
    recordLandedCostEntry({ ...base, componentType: "financing", expectedAmount: input.financeFx, confidence: "low", source: "Trader-reported at deal creation" }),
    input.insuranceCollected
      ? recordLandedCostEntry({ ...base, componentType: "insurance", expectedAmount: input.insurance, confidence: "low", source: "Trader-reported at deal creation" })
      : recordLandedCostEntry({ ...base, componentType: "insurance", expectedAmount: 0, isExcluded: true, source: "Not collected at deal creation — no insurance estimate on file yet." }),
    input.inspectionCollected
      ? recordLandedCostEntry({ ...base, componentType: "inspection", expectedAmount: input.inspection, confidence: "low", source: "Trader-reported at deal creation" })
      : recordLandedCostEntry({ ...base, componentType: "inspection", expectedAmount: 0, isExcluded: true, source: "Not collected at deal creation — no inspection estimate on file yet." }),
    recordLandedCostEntry({ ...base, componentType: "brokerage", expectedAmount: 0, isExcluded: true, source: "Not yet quoted — no brokerage estimate collected." }),
    // TradeSafe Africa's own fee — a real, checkable fact (this
    // codebase's fee schedule), not a guess: no fee is currently charged
    // anywhere in the app (confirmed by inspection — no billing/fee
    // logic exists), so $0 here is honestly the current state, with the
    // assumption stated explicitly rather than silently implied
    // permanent.
    recordLandedCostEntry({ ...base, componentType: "tradesafe_fees", expectedAmount: 0, confidence: "high", source: "TradeSafe Africa platform fee schedule", assumptions: "TradeSafe Africa does not currently charge a listed platform fee. This is subject to change; no fee schedule has been published." }),
  ]);
}
