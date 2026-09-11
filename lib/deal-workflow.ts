// Priority 7 (docs/production-readiness.md): "Implement a controlled deal
// state machine ... Prevent users from skipping required stages through
// direct API calls."
//
// Before this: deals.stage was a free-text field any reviewer could PATCH
// to ANY of 9 unordered values via app/api/admin/desk/route.ts, with zero
// adjacency checking — a real reviewer could move a brand-new deal
// straight from "intake" to "closed" in one request, no preconditions,
// no role differentiation. This module is the actual fix: a directed
// graph of the mission's 13 stages, each transition gated by an
// authorized-role check AND, wherever this platform's data model can
// genuinely support it, a real precondition check — not a fabricated
// one. See PRECONDITION_HONESTY below for exactly which checks are real
// versus which stages are human attestations (and why).
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../db";
import { deals, dealEvents, dealParties, milestones, quotes, quoteRequests } from "../db/schema";
import { resolveOrganizationVerificationLevel } from "./verification-levels";
import type { SessionUser } from "./auth/current-user";
import { DEAL_STAGES, nextStage, type DealStage } from "./deal-stages";

export { DEAL_STAGES, nextStage, type DealStage };

type Precondition = (dealId: number) => Promise<{ ok: true } | { ok: false; reason: string }>;

interface StageTransition {
  from: DealStage;
  to: DealStage;
  // Which platform roles may perform this transition. Everything here
  // stays reviewer-gated (administrator/verification_analyst) because
  // deal-stage mutation has only ever gone through the admin desk (see
  // app/api/admin/desk/route.ts) — a trader's own actions (uploading
  // evidence, requesting a quote) already write to their own tables and
  // don't need a separate "advance the stage" permission on top.
  // administrator-only for the two highest-stakes transitions: confirming
  // money moved, and closing the deal for good.
  authorizedRoles: readonly ("administrator" | "verification_analyst")[];
  // PRECONDITION HONESTY: a real, DB-checked condition where this
  // platform's data model can actually observe it happened (parties
  // exist, quotes exist, a quote was accepted, the counterparty's
  // verification level). Where this platform has no real signal — it
  // does not hold money, does not run logistics, does not clear customs
  // (see docs/AUDIT.md's "never claim to be a licensed provider" rule)
  // — the precondition is null, and the transition is a human
  // attestation instead: reason is already required on every admin desk
  // action (unchanged, pre-existing), which is the only honest gate this
  // platform can offer for something it cannot independently verify.
  precondition: Precondition | null;
  reversible: boolean;
}

async function partiesExist(dealId: number) {
  const db = getDb();
  const parties = await db.select().from(dealParties).where(and(eq(dealParties.dealId, dealId), isNull(dealParties.removedAt)));
  if (parties.length === 0) return { ok: false as const, reason: "No parties are assigned to this deal yet (deal_parties)." };
  return { ok: true as const };
}

async function counterpartiesVerified(dealId: number) {
  const db = getDb();
  const parties = await db.select().from(dealParties).where(and(eq(dealParties.dealId, dealId), isNull(dealParties.removedAt)));
  const withOrg = parties.filter((p) => p.organizationId != null);
  for (const party of withOrg) {
    const { level } = await resolveOrganizationVerificationLevel(party.organizationId as number);
    if (level < 1) {
      return { ok: false as const, reason: `Party "${party.name || party.role}" (organization #${party.organizationId}) has not reached verification level 1 (identity) yet.` };
    }
  }
  // Parties recorded by contact only (no organizationId) can't be checked
  // against organization_verifications — a real, documented gap, not
  // silently treated as "verified." See docs/production-readiness.md.
  return { ok: true as const };
}

async function quotesExist(dealId: number) {
  const db = getDb();
  const rows = await db.select({ id: quotes.id }).from(quotes).innerJoin(quoteRequests, eq(quotes.quoteRequestId, quoteRequests.id)).where(eq(quoteRequests.dealId, dealId)).limit(1);
  if (rows.length === 0) return { ok: false as const, reason: "No quotes have been submitted for this deal yet." };
  return { ok: true as const };
}

async function quoteAccepted(dealId: number) {
  const db = getDb();
  const rows = await db.select({ id: quotes.id }).from(quotes).innerJoin(quoteRequests, eq(quotes.quoteRequestId, quoteRequests.id)).where(and(eq(quoteRequests.dealId, dealId), eq(quotes.status, "accepted"))).limit(1);
  if (rows.length === 0) return { ok: false as const, reason: "No quote has been accepted for this deal yet." };
  return { ok: true as const };
}

async function preshipmentEvidenceApproved(dealId: number) {
  // Maps to this deal's "Verified loading" milestone (sequence 2 in the
  // default seed — see app/api/deals/route.ts) — the closest existing
  // concept to "pre-shipment evidence." This is a soft, name/sequence-based
  // coupling, not a formal FK, because milestones and workflow stages
  // aren't linked in the schema yet — a real, documented limitation (see
  // docs/production-readiness.md), not pretended away.
  const db = getDb();
  const [milestone] = await db.select().from(milestones).where(and(eq(milestones.dealId, dealId), eq(milestones.sequence, 2))).limit(1);
  if (!milestone || milestone.evidenceStatus !== "verified") {
    return { ok: false as const, reason: "Pre-shipment (loading) evidence has not been verified for this deal's milestones yet." };
  }
  return { ok: true as const };
}

export const DEAL_TRANSITIONS: StageTransition[] = [
  { from: "request_confirmed", to: "parties_assigned", authorizedRoles: ["administrator", "verification_analyst"], precondition: partiesExist, reversible: true },
  { from: "parties_assigned", to: "counterparties_verified", authorizedRoles: ["administrator", "verification_analyst"], precondition: counterpartiesVerified, reversible: true },
  { from: "counterparties_verified", to: "quotes_received", authorizedRoles: ["administrator", "verification_analyst"], precondition: quotesExist, reversible: false },
  { from: "quotes_received", to: "landed_cost_reviewed", authorizedRoles: ["administrator", "verification_analyst"], precondition: null, reversible: false },
  { from: "landed_cost_reviewed", to: "quote_accepted", authorizedRoles: ["administrator", "verification_analyst"], precondition: quoteAccepted, reversible: false },
  { from: "quote_accepted", to: "preshipment_evidence_approved", authorizedRoles: ["administrator", "verification_analyst"], precondition: preshipmentEvidenceApproved, reversible: false },
  // Payment confirmation and closing are administrator-only — the two
  // transitions this platform must never let a lower-trust reviewer
  // attest to alone, given the mission's explicit "TradeSafe never holds
  // or moves money" rule (docs/AUDIT.md) — an administrator recording
  // "a licensed partner confirmed payment happened" is a materially
  // bigger claim than a verification_analyst reviewing evidence.
  { from: "preshipment_evidence_approved", to: "payment_confirmed", authorizedRoles: ["administrator"], precondition: null, reversible: false },
  { from: "payment_confirmed", to: "goods_dispatched", authorizedRoles: ["administrator", "verification_analyst"], precondition: null, reversible: false },
  { from: "goods_dispatched", to: "customs_evidence_received", authorizedRoles: ["administrator", "verification_analyst"], precondition: null, reversible: false },
  { from: "customs_evidence_received", to: "delivery_confirmed", authorizedRoles: ["administrator", "verification_analyst"], precondition: null, reversible: false },
  { from: "delivery_confirmed", to: "costs_reconciled", authorizedRoles: ["administrator", "verification_analyst"], precondition: null, reversible: false },
  { from: "costs_reconciled", to: "closed", authorizedRoles: ["administrator"], precondition: null, reversible: false },
];

// nextStage() is re-exported from ./deal-stages (see the import above) —
// DEAL_TRANSITIONS is a strictly linear chain (each stage has exactly one
// outgoing edge, matching deal-stages.ts's DEAL_STAGE_ORDER exactly), so
// there's deliberately only one implementation of "what's next," not two
// that could silently drift apart.

export type TransitionResult =
  | { ok: true; deal: typeof deals.$inferSelect; fromStage: DealStage }
  | { ok: false; status: 400 | 403 | 404; error: string };

/**
 * The ONLY sanctioned way to move a deal's stage forward. Validates, in
 * order: the deal exists; the requested "to" stage is actually the next
 * stage from wherever the deal currently is (not any arbitrary stage —
 * this is what closes the "skip straight to closed" gap); the acting
 * user's platform role is authorized for this specific transition; and,
 * where a real precondition exists, that it's actually satisfied. Every
 * successful transition writes a dealEvents row — this IS the audit
 * trail the mission asks for per transition, reusing the event log every
 * other deal action already writes to rather than inventing a parallel one.
 */
export async function attemptDealTransition(dealId: number, toStage: string, user: SessionUser, reason: string): Promise<TransitionResult> {
  const db = getDb();
  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId)).limit(1);
  if (!deal) return { ok: false, status: 404, error: "Deal not found." };

  const edge = DEAL_TRANSITIONS.find((t) => t.from === deal.stage && t.to === toStage);
  if (!edge) {
    const legalNext = nextStage(deal.stage);
    return {
      ok: false,
      status: 400,
      error: legalNext
        ? `This deal is at "${deal.stage}" — the only legal next stage is "${legalNext}", not "${toStage}".`
        : `This deal is at "${deal.stage}", which has no further stage to advance to.`,
    };
  }

  if (!edge.authorizedRoles.includes(user.platformRole as "administrator" | "verification_analyst")) {
    return { ok: false, status: 403, error: `Only ${edge.authorizedRoles.join(" or ")} may perform this transition.` };
  }

  if (edge.precondition) {
    const result = await edge.precondition(dealId);
    if (!result.ok) return { ok: false, status: 400, error: result.reason };
  }

  const now = new Date().toISOString();
  const [updated] = await db.update(deals).set({ stage: toStage, updatedAt: now }).where(eq(deals.id, dealId)).returning();
  await db.insert(dealEvents).values({
    dealId,
    actorEmail: user.email,
    eventType: "stage_transition",
    summary: `${deal.stage} → ${toStage}: ${reason}`,
  });

  return { ok: true, deal: updated, fromStage: edge.from };
}
