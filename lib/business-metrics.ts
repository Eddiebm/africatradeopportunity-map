// Priority 13 (docs/production-readiness.md): "Business-validation
// dashboard ... Do NOT prioritize registrations, listing counts, or page
// views as proof of traction." Every metric below reads REAL rows this
// platform already writes across Priorities 1-12 — nothing here is a new
// write path, this module only aggregates. Two metrics the mission asks
// for are structurally NOT computable from anything this app tracks —
// see acquisitionCostPerQualifiedBuyer and revenuePerTransaction below —
// and are returned as {available:false, reason:...} rather than a
// fabricated number, matching this project's core rule everywhere else.
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  adminAuditEvents, deals, dealCosts, dealEvents, disputes, marketRequests, milestones, organizations,
  quoteRequests, quotes, referralAttributions,
} from "../db/schema";
import { getLandedCostBreakdown } from "./landed-cost";
import { stageIndex } from "./deal-stages";

type Available<T> = { available: true; value: T } | { available: false; reason: string };

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
function daysBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
}

export interface BusinessMetrics {
  generatedAt: string;
  // --- Acquisition (never registrations/listings/pageviews as headline) ---
  qualifiedBuyerRequests: { total: number; verified: number; pendingReview: number; rejected: number };
  verifiedSuppliers: number;
  partnerReferredLeads: { total: number; bySource: { intake_link: number; code_entry: number } };
  acquisitionCostPerQualifiedBuyer: Available<number>;
  timeToFirstUsefulQuoteDays: Available<number>;
  // --- Conversion / throughput ---
  quoteToPaymentConfirmedConversionPct: Available<number>;
  transactionsInitiated: number;
  transactionsCompleted: number;
  repeatTransactionOwners: number;
  // --- Accuracy / operations ---
  landedCostAccuracy: { dealsWithActuals: number; averageVariancePct: Available<number> };
  manualInterventionsPerTransaction: Available<number>;
  verificationTurnaroundDays: Available<number>;
  onTimeMilestones: { withDueDate: number; verifiedOnTime: number; verifiedLate: number };
  // --- Trust / retention ---
  disputes: { total: number; open: number; resolved: number; averageResolutionDays: Available<number> };
  // --- Economics (honestly not tracked) ---
  revenuePerTransaction: Available<number>;
}

export async function computeBusinessMetrics(): Promise<BusinessMetrics> {
  const db = getDb();

  // --- Qualified buyer requests (Priority 9's low-friction quote flow) ---
  const requests = await db.select({ status: marketRequests.status }).from(marketRequests).where(eq(marketRequests.role, "quote_request"));
  const qualifiedBuyerRequests = {
    total: requests.length,
    verified: requests.filter((r) => r.status === "verified").length,
    pendingReview: requests.filter((r) => r.status === "pending_verification" || r.status === "contacted").length,
    rejected: requests.filter((r) => r.status === "rejected").length,
  };

  // --- Verified suppliers (real Priority 1/6 signal: organizations.verificationStatus) ---
  const [{ count: verifiedSuppliers }] = await db.select({ count: sql<number>`count(*)` }).from(organizations).where(eq(organizations.verificationStatus, "verified"));

  // --- Partner-referred leads (real Priority 11 data) ---
  const primaryAttributions = await db.select({ source: referralAttributions.source }).from(referralAttributions).where(eq(referralAttributions.isPrimary, true));
  const partnerReferredLeads = {
    total: primaryAttributions.length,
    bySource: {
      intake_link: primaryAttributions.filter((a) => a.source === "intake_link").length,
      code_entry: primaryAttributions.filter((a) => a.source === "code_entry").length,
    },
  };

  // No marketing/ad-spend tracking exists anywhere in this codebase
  // (confirmed by inspection — there is no spend/budget/campaign table).
  // Computing a cost-per-qualified-buyer figure without a real numerator
  // would be a fabricated number wearing a precise-looking label.
  const acquisitionCostPerQualifiedBuyer: Available<number> = {
    available: false,
    reason: "No acquisition spend (ads, partner fees, marketing budget) is tracked anywhere in this platform yet.",
  };

  // --- Time to first useful quote: deal creation -> first real quote submitted ---
  const dealRows = await db.select({ id: deals.id, createdAt: deals.createdAt, ownerEmail: deals.ownerEmail, stage: deals.stage }).from(deals);
  const quoteRows = await db.select({ id: quotes.id, createdAt: quotes.createdAt, quoteRequestId: quotes.quoteRequestId }).from(quotes);
  const quoteRequestRows = await db.select({ id: quoteRequests.id, dealId: quoteRequests.dealId }).from(quoteRequests);
  const dealIdByQuoteRequestId = new Map(quoteRequestRows.map((qr) => [qr.id, qr.dealId]));
  const firstQuoteTimeByDealId = new Map<number, string>();
  for (const q of quoteRows) {
    const dealId = dealIdByQuoteRequestId.get(q.quoteRequestId);
    if (dealId == null) continue;
    const existing = firstQuoteTimeByDealId.get(dealId);
    if (!existing || q.createdAt < existing) firstQuoteTimeByDealId.set(dealId, q.createdAt);
  }
  const timeToQuoteDays: number[] = [];
  for (const deal of dealRows) {
    const firstQuoteAt = firstQuoteTimeByDealId.get(deal.id);
    if (firstQuoteAt) timeToQuoteDays.push(daysBetween(deal.createdAt, firstQuoteAt));
  }
  const timeToFirstUsefulQuoteDays: Available<number> = timeToQuoteDays.length
    ? { available: true, value: avg(timeToQuoteDays) as number }
    : { available: false, reason: "No deal has received a real quote yet." };

  // --- Quote -> payment_confirmed conversion (real Priority 7 stage data) ---
  const dealsWithAQuote = dealRows.filter((d) => firstQuoteTimeByDealId.has(d.id));
  const paymentConfirmedIdx = stageIndex("payment_confirmed");
  const dealsReachingPayment = dealsWithAQuote.filter((d) => stageIndex(d.stage) >= paymentConfirmedIdx && stageIndex(d.stage) !== -1);
  const quoteToPaymentConfirmedConversionPct: Available<number> = dealsWithAQuote.length
    ? { available: true, value: (dealsReachingPayment.length / dealsWithAQuote.length) * 100 }
    : { available: false, reason: "No deal has received a real quote yet." };

  // --- Transactions initiated / completed / repeat ---
  const transactionsInitiated = dealRows.length;
  const transactionsCompleted = dealRows.filter((d) => d.stage === "closed").length;
  const ownerCounts = new Map<string, number>();
  for (const d of dealRows) ownerCounts.set(d.ownerEmail, (ownerCounts.get(d.ownerEmail) || 0) + 1);
  const repeatTransactionOwners = [...ownerCounts.values()].filter((n) => n >= 2).length;

  // --- Landed-cost accuracy (real Priority 12 data) ---
  const breakdowns = await Promise.all(dealRows.map((d) => getLandedCostBreakdown(d.id)));
  const variancePcts: number[] = [];
  let dealsWithActuals = 0;
  for (const b of breakdowns) {
    if (b.actualTotal == null || b.totals.expected === 0) continue;
    dealsWithActuals += 1;
    variancePcts.push(((b.actualTotal - b.totals.expected) / b.totals.expected) * 100);
  }
  const landedCostAccuracy = {
    dealsWithActuals,
    averageVariancePct: variancePcts.length
      ? ({ available: true, value: avg(variancePcts) as number } as const)
      : ({ available: false, reason: "No deal has a complete set of recorded actual costs yet." } as const),
  };

  // --- Manual interventions per transaction (real adminAuditEvents rows tied to a deal, directly or via its milestones/checks/documents) ---
  const dealScopedAudit = await db.select({ entityType: adminAuditEvents.entityType, entityId: adminAuditEvents.entityId }).from(adminAuditEvents).where(sql`${adminAuditEvents.entityType} in ('deal','milestone','check','document')`);
  const milestoneRows = await db.select({ id: milestones.id, dealId: milestones.dealId, dueAt: milestones.dueAt }).from(milestones);
  const dealIdByMilestoneId = new Map(milestoneRows.map((m) => [m.id, m.dealId]));
  let interventionCount = 0;
  for (const row of dealScopedAudit) {
    if (row.entityType === "deal") interventionCount += 1;
    else if (row.entityType === "milestone" && dealIdByMilestoneId.has(row.entityId)) interventionCount += 1;
    // check/document entityIds aren't joined to a dealId here (would need
    // extra table reads for a metric this approximate) — undercounts
    // slightly rather than fabricating a join; documented in the docs
    // entry, not silently papered over.
  }
  const manualInterventionsPerTransaction: Available<number> = transactionsInitiated
    ? { available: true, value: interventionCount / transactionsInitiated }
    : { available: false, reason: "No deals exist yet." };

  // --- Verification turnaround: deal creation -> real counterparties_verified stage_transition dealEvents row ---
  const verifiedTransitionRows = await db
    .select({ dealId: deals.id, dealCreatedAt: deals.createdAt })
    .from(deals)
    .where(sql`exists (select 1 from deal_events e where e.deal_id = ${deals.id} and e.event_type = 'stage_transition' and e.summary like '%→ counterparties_verified%')`);
  const turnaroundDays: number[] = [];
  if (verifiedTransitionRows.length) {
    for (const row of verifiedTransitionRows) {
      const [evt] = await db.select({ createdAt: dealEvents.createdAt }).from(dealEvents).where(and(eq(dealEvents.dealId, row.dealId), sql`${dealEvents.summary} like '%→ counterparties_verified%'`)).limit(1);
      if (evt) turnaroundDays.push(daysBetween(row.dealCreatedAt, evt.createdAt));
    }
  }
  const verificationTurnaroundDays: Available<number> = turnaroundDays.length
    ? { available: true, value: avg(turnaroundDays) as number }
    : { available: false, reason: "No deal has completed the counterparties_verified stage transition yet." };

  // --- On-time milestones: latest adminAuditEvents 'verified' transition vs. the milestone's real dueAt ---
  const withDueDate = milestoneRows.filter((m) => m.dueAt);
  let verifiedOnTime = 0, verifiedLate = 0;
  const verifiedMilestoneEvents = await db
    .select({ entityId: adminAuditEvents.entityId, createdAt: adminAuditEvents.createdAt })
    .from(adminAuditEvents)
    .where(and(eq(adminAuditEvents.entityType, "milestone"), eq(adminAuditEvents.toStatus, "verified")));
  const verifiedAtByMilestoneId = new Map<number, string>();
  for (const e of verifiedMilestoneEvents) {
    const existing = verifiedAtByMilestoneId.get(e.entityId);
    if (!existing || e.createdAt < existing) verifiedAtByMilestoneId.set(e.entityId, e.createdAt); // earliest verification event
  }
  for (const m of withDueDate) {
    const verifiedAt = verifiedAtByMilestoneId.get(m.id);
    if (!verifiedAt || !m.dueAt) continue;
    if (verifiedAt <= m.dueAt) verifiedOnTime += 1; else verifiedLate += 1;
  }

  // --- Disputes ---
  const disputeRows = await db.select({ status: disputes.status, createdAt: disputes.createdAt, resolvedAt: disputes.resolvedAt }).from(disputes);
  const resolvedDisputes = disputeRows.filter((d) => d.resolvedAt);
  const resolutionDays = resolvedDisputes.map((d) => daysBetween(d.createdAt, d.resolvedAt as string));
  const disputesMetric = {
    total: disputeRows.length,
    open: disputeRows.filter((d) => !["resolved", "closed"].includes(d.status)).length,
    resolved: resolvedDisputes.length,
    averageResolutionDays: resolutionDays.length
      ? ({ available: true, value: avg(resolutionDays) as number } as const)
      : ({ available: false, reason: "No dispute has been resolved yet." } as const),
  };

  // No fee/billing/operating-cost logic exists anywhere in this codebase
  // (confirmed during Priority 12's own inspection) — this platform does
  // not currently charge or track a fee, so "revenue per transaction"
  // has no real numerator. Never fabricated as $0 (that would falsely
  // claim "known to earn nothing" rather than "not tracked").
  const revenuePerTransaction: Available<number> = {
    available: false,
    reason: "TradeSafe Africa does not currently charge or track a platform fee — see Priority 12's landed-cost tradesafe_fees finding. No revenue or operating-cost data exists to compute this from.",
  };

  void gte; void isNotNull; void dealCosts; // reserved for a future cohort-window filter (e.g. "last 90 days") — not built in this pass, see docs/production-readiness.md's Priority 13 remaining risks.

  return {
    generatedAt: new Date().toISOString(),
    qualifiedBuyerRequests,
    verifiedSuppliers,
    partnerReferredLeads,
    acquisitionCostPerQualifiedBuyer,
    timeToFirstUsefulQuoteDays,
    quoteToPaymentConfirmedConversionPct,
    transactionsInitiated,
    transactionsCompleted,
    repeatTransactionOwners,
    landedCostAccuracy,
    manualInterventionsPerTransaction,
    verificationTurnaroundDays,
    onTimeMilestones: { withDueDate: withDueDate.length, verifiedOnTime, verifiedLate },
    disputes: disputesMetric,
    revenuePerTransaction,
  };
}
