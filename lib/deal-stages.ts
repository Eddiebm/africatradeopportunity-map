// Priority 7 (docs/production-readiness.md): the pure, dependency-free
// half of the deal workflow — just the stage list and adjacency lookup.
// Split out from lib/deal-workflow.ts specifically so client components
// (e.g. app/admin/page.tsx, "use client") can import nextStage() without
// pulling in getDb/cloudflare:workers, which lib/deal-workflow.ts's
// attemptDealTransition and its precondition checks depend on — that
// import chain must never reach a browser bundle.
export const DEAL_STAGES = [
  "request_confirmed",
  "parties_assigned",
  "counterparties_verified",
  "quotes_received",
  "landed_cost_reviewed",
  "quote_accepted",
  "preshipment_evidence_approved",
  "payment_confirmed",
  "goods_dispatched",
  "customs_evidence_received",
  "delivery_confirmed",
  "costs_reconciled",
  "closed",
] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const DEAL_STAGE_ORDER: readonly DealStage[] = DEAL_STAGES;

export function nextStage(current: string): DealStage | null {
  const index = DEAL_STAGE_ORDER.indexOf(current as DealStage);
  if (index < 0 || index === DEAL_STAGE_ORDER.length - 1) return null;
  return DEAL_STAGE_ORDER[index + 1];
}

// Priority 8 introduced this exact logic locally in lib/exceptions.ts;
// Priority 13's lib/business-metrics.ts needs the identical "how far
// along is this deal" comparison — promoted here as the one shared
// implementation rather than a third private copy. -1 for an unknown/
// legacy stage value (e.g. the old "intake"), matching nextStage()'s own
// treatment of that case.
export function stageIndex(stage: string): number {
  return DEAL_STAGE_ORDER.indexOf(stage as DealStage);
}
