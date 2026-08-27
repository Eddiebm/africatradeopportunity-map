// Priority 8 (docs/production-readiness.md): "Build an exception operations
// queue ... The standard operational path should not require manually
// monitoring every deal; staff attention should focus on exceptions." See
// db/schema.ts's `exceptions` table header for the full data-model
// rationale (dedupe via the reused idempotency-keys insert-claim pattern,
// audit trail via the existing adminAuditEvents table).
//
// Every detector below reads REAL rows from tables this platform already
// writes — never a fabricated signal. Where no real signal exists yet for
// something the mission asks for ("material landed-cost changes" needs a
// cost-revision history this app doesn't have; dealCosts is write-once at
// deal creation, never updated by any route), there is deliberately no
// detector — see docs/production-readiness.md's Priority 8 section for
// that explicit, intentional deferral rather than a fabricated one.
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb } from "../db";
import {
  deals,
  dealCosts,
  dealDocuments,
  dealParties,
  disputes,
  exceptions,
  milestones,
  organizationVerifications,
  organizations,
  verificationChecks,
  type ExceptionSeverity,
  type ExceptionType,
} from "../db/schema";
import { DEAL_STAGES } from "./deal-stages";
import { resolveCorridorTier } from "./corridor-templates";
import { resolveOrganizationVerificationLevel } from "./verification-levels";

// --- Policy thresholds ---------------------------------------------------
// THIS PLATFORM'S OWN operational policy (same honesty convention as
// lib/verification-levels.ts's recommendVerificationLevel: illustrative,
// documented, not sourced from any external SLA or regulation). Exported so
// tests and docs/production-readiness.md can reference the exact numbers
// rather than restating them.
export const DISPUTE_RESPONSE_SLA_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
export const PAYMENT_EXCEPTION_THRESHOLD_MS = 5 * 24 * 60 * 60 * 1000; // 5 days stalled at preshipment_evidence_approved
export const STALLED_DEAL_THRESHOLD_MS = 10 * 24 * 60 * 60 * 1000; // 10 days with no stage movement
export const HIGH_VALUE_DEAL_USD = 250_000; // matches lib/verification-levels.ts's own threshold, for consistency

interface DetectedCondition {
  exceptionType: ExceptionType;
  severity: ExceptionSeverity;
  dealId: number | null;
  organizationId: number | null;
  disputeId: number | null;
  entityType: string;
  entityId: number;
  summary: string;
  responsibleParty: string;
  deadline: string | null;
}

function dedupeKeyFor(c: Pick<DetectedCondition, "exceptionType" | "entityType" | "entityId">): string {
  return `${c.exceptionType}:${c.entityType}:${c.entityId}`;
}

function stageIndex(stage: string): number {
  return DEAL_STAGES.indexOf(stage as (typeof DEAL_STAGES)[number]);
}

const REVIEW_TEAM = "TradeSafe review team";

async function detectFailedVerificationChecks(): Promise<DetectedCondition[]> {
  const db = getDb();
  const rows = await db.select().from(verificationChecks).where(eq(verificationChecks.status, "failed"));
  if (rows.length === 0) return [];
  const dealIds = [...new Set(rows.map((r) => r.dealId))];
  const dealRows = await db.select().from(deals).where(inArray(deals.id, dealIds));
  const dealById = new Map(dealRows.map((d) => [d.id, d]));
  return rows.flatMap((row) => {
    const deal = dealById.get(row.dealId);
    if (!deal) return [];
    return [{
      exceptionType: "failed_verification_check" as const,
      severity: "high" as const,
      dealId: deal.id,
      organizationId: null,
      disputeId: null,
      entityType: "verification_check",
      entityId: row.id,
      summary: `"${row.checkType.replaceAll("_", " ")}" verification failed on deal ${deal.reference}.`,
      responsibleParty: deal.ownerEmail,
      deadline: null,
    }];
  });
}

async function detectExpiredVerificationChecks(): Promise<DetectedCondition[]> {
  const db = getDb();
  const now = new Date().toISOString();
  const rows = await db.select().from(verificationChecks).where(and(eq(verificationChecks.status, "verified"), isNotNull(verificationChecks.expiresAt)));
  const expired = rows.filter((r) => r.expiresAt && r.expiresAt < now);
  if (expired.length === 0) return [];
  const dealIds = [...new Set(expired.map((r) => r.dealId))];
  const dealRows = await getDb().select().from(deals).where(inArray(deals.id, dealIds));
  const dealById = new Map(dealRows.map((d) => [d.id, d]));
  return expired.flatMap((row) => {
    const deal = dealById.get(row.dealId);
    if (!deal) return [];
    return [{
      exceptionType: "expired_verification_check" as const,
      severity: "medium" as const,
      dealId: deal.id,
      organizationId: null,
      disputeId: null,
      entityType: "verification_check",
      entityId: row.id,
      summary: `"${row.checkType.replaceAll("_", " ")}" verification on deal ${deal.reference} expired on ${row.expiresAt} and needs to be rechecked.`,
      responsibleParty: REVIEW_TEAM,
      deadline: row.expiresAt,
    }];
  });
}

/** Only the LATEST fact per (organizationId, levelKey) counts — an earlier
 * failed/expired row that a later re-check superseded is history, not an
 * open exception. Mirrors resolveOrganizationVerificationLevel's own
 * "append-only, most recent wins" reading of this table. */
async function latestOrgVerificationFacts(): Promise<Map<string, typeof organizationVerifications.$inferSelect>> {
  const rows = await getDb().select().from(organizationVerifications);
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.organizationId}:${row.levelKey}`;
    const current = latest.get(key);
    if (!current || row.id > current.id) latest.set(key, row);
  }
  return latest;
}

async function detectOrganizationVerificationExceptions(): Promise<DetectedCondition[]> {
  const latest = await latestOrgVerificationFacts();
  const now = new Date().toISOString();
  const failed = [...latest.values()].filter((r) => r.result === "failed");
  const expired = [...latest.values()].filter((r) => r.result === "passed" && !r.humanReviewRequired && r.expiresAt && r.expiresAt < now);
  if (failed.length === 0 && expired.length === 0) return [];
  const orgIds = [...new Set([...failed, ...expired].map((r) => r.organizationId))];
  const orgRows = await getDb().select().from(organizations).where(inArray(organizations.id, orgIds));
  const orgById = new Map(orgRows.map((o) => [o.id, o]));
  const out: DetectedCondition[] = [];
  for (const row of failed) {
    const org = orgById.get(row.organizationId);
    if (!org) continue;
    out.push({
      exceptionType: "failed_organization_verification",
      severity: "high",
      dealId: null,
      organizationId: org.id,
      disputeId: null,
      entityType: "organization_verification",
      entityId: row.id,
      summary: `${org.legalName}'s "${row.levelKey.replaceAll("_", " ")}" verification failed.${row.notes ? ` ${row.notes}` : ""}`,
      responsibleParty: org.ownerEmail,
      deadline: null,
    });
  }
  for (const row of expired) {
    const org = orgById.get(row.organizationId);
    if (!org) continue;
    out.push({
      exceptionType: "expired_organization_verification",
      severity: "medium",
      dealId: null,
      organizationId: org.id,
      disputeId: null,
      entityType: "organization_verification",
      entityId: row.id,
      summary: `${org.legalName}'s "${row.levelKey.replaceAll("_", " ")}" verification expired on ${row.expiresAt} — a gap here caps this organization's verification level (see lib/verification-levels.ts).`,
      responsibleParty: org.ownerEmail,
      deadline: row.expiresAt,
    });
  }
  return out;
}

async function detectDocumentExceptions(): Promise<DetectedCondition[]> {
  const db = getDb();
  const rejected = await db.select().from(dealDocuments).where(eq(dealDocuments.status, "rejected"));
  const required = await db.select().from(dealDocuments).where(eq(dealDocuments.status, "required"));
  if (rejected.length === 0 && required.length === 0) return [];
  const dealIds = [...new Set([...rejected, ...required].map((r) => r.dealId))];
  const dealRows = await db.select().from(deals).where(inArray(deals.id, dealIds));
  const dealById = new Map(dealRows.map((d) => [d.id, d]));
  const out: DetectedCondition[] = [];
  for (const row of rejected) {
    const deal = dealById.get(row.dealId);
    if (!deal) continue;
    out.push({
      exceptionType: "rejected_document",
      severity: "medium",
      dealId: deal.id,
      organizationId: null,
      disputeId: null,
      entityType: "deal_document",
      entityId: row.id,
      summary: `"${row.documentType.replaceAll("_", " ")}" was rejected on deal ${deal.reference} and has not been replaced.`,
      responsibleParty: deal.ownerEmail,
      deadline: null,
    });
  }
  // "Missing" is a stage-based heuristic, not a day-count one — this table
  // has no createdAt to measure elapsed time against (a real, documented
  // gap; see docs/production-readiness.md). A document still "required"
  // once the deal has progressed as far as an accepted quote is worth
  // flagging; before that point it's simply not due yet.
  const quoteAcceptedIdx = stageIndex("quote_accepted");
  for (const row of required) {
    const deal = dealById.get(row.dealId);
    if (!deal) continue;
    if (stageIndex(deal.stage) < quoteAcceptedIdx) continue;
    out.push({
      exceptionType: "missing_required_document",
      severity: "medium",
      dealId: deal.id,
      organizationId: null,
      disputeId: null,
      entityType: "deal_document",
      entityId: row.id,
      summary: `"${row.documentType.replaceAll("_", " ")}" is still required on deal ${deal.reference}, which has already reached "${deal.stage.replaceAll("_", " ")}".`,
      responsibleParty: deal.ownerEmail,
      deadline: null,
    });
  }
  return out;
}

async function detectOverdueMilestones(): Promise<DetectedCondition[]> {
  const db = getDb();
  const now = new Date().toISOString();
  const rows = await db.select().from(milestones).where(isNotNull(milestones.dueAt));
  const overdue = rows.filter((r) => r.dueAt && r.dueAt < now && r.evidenceStatus !== "verified");
  if (overdue.length === 0) return [];
  const dealIds = [...new Set(overdue.map((r) => r.dealId))];
  const dealRows = await db.select().from(deals).where(inArray(deals.id, dealIds));
  const dealById = new Map(dealRows.map((d) => [d.id, d]));
  return overdue.flatMap((row) => {
    const deal = dealById.get(row.dealId);
    if (!deal) return [];
    const submitted = row.evidenceStatus === "submitted";
    return [{
      exceptionType: "overdue_milestone" as const,
      severity: (submitted ? "medium" : "high") as ExceptionSeverity,
      dealId: deal.id,
      organizationId: null,
      disputeId: null,
      entityType: "milestone",
      entityId: row.id,
      summary: submitted
        ? `Milestone "${row.name}" on deal ${deal.reference} was due ${row.dueAt} — evidence was submitted but is still awaiting review.`
        : `Milestone "${row.name}" on deal ${deal.reference} was due ${row.dueAt} and no evidence has been submitted.`,
      responsibleParty: submitted ? REVIEW_TEAM : deal.ownerEmail,
      deadline: row.dueAt,
    }];
  });
}

async function detectDealStageExceptions(): Promise<DetectedCondition[]> {
  const db = getDb();
  const rows = await db.select().from(deals);
  const now = Date.now();
  const out: DetectedCondition[] = [];
  for (const deal of rows) {
    const idx = stageIndex(deal.stage);
    if (idx === -1 || deal.stage === "closed") continue; // legacy/unknown stage or already done

    // Stalled / payment exceptions — real signal: deals.updatedAt is set on
    // every stage transition (lib/deal-workflow.ts's attemptDealTransition),
    // so "no movement since updatedAt" is a genuine, not fabricated, read.
    const updatedMs = Date.parse(deal.updatedAt);
    if (!Number.isNaN(updatedMs)) {
      const ageMs = now - updatedMs;
      if (deal.stage === "preshipment_evidence_approved" && ageMs > PAYMENT_EXCEPTION_THRESHOLD_MS) {
        out.push({
          exceptionType: "payment_exception",
          severity: "high",
          dealId: deal.id,
          organizationId: null,
          disputeId: null,
          entityType: "deal",
          entityId: deal.id,
          summary: `Deal ${deal.reference} has been waiting on payment confirmation since ${deal.updatedAt} — this platform never holds funds, so this needs a licensed payment partner's status, not an automated check.`,
          responsibleParty: REVIEW_TEAM,
          deadline: new Date(updatedMs + PAYMENT_EXCEPTION_THRESHOLD_MS).toISOString(),
        });
      } else if (ageMs > STALLED_DEAL_THRESHOLD_MS) {
        out.push({
          exceptionType: "stalled_deal",
          severity: "medium",
          dealId: deal.id,
          organizationId: null,
          disputeId: null,
          entityType: "deal",
          entityId: deal.id,
          summary: `Deal ${deal.reference} has not advanced past "${deal.stage.replaceAll("_", " ")}" since ${deal.updatedAt}.`,
          responsibleParty: REVIEW_TEAM,
          deadline: new Date(updatedMs + STALLED_DEAL_THRESHOLD_MS).toISOString(),
        });
      }
    }
  }
  return out;
}

async function detectHighRiskDeals(): Promise<DetectedCondition[]> {
  const db = getDb();
  const rows = await db.select({ deal: deals, costs: dealCosts }).from(deals).innerJoin(dealCosts, eq(dealCosts.dealId, deals.id));
  const partiesAssignedIdx = stageIndex("parties_assigned");
  const counterpartiesVerifiedIdx = stageIndex("counterparties_verified");
  const out: DetectedCondition[] = [];
  for (const { deal, costs } of rows) {
    const idx = stageIndex(deal.stage);
    if (idx === -1 || deal.stage === "closed") continue;

    if (costs.supplierCost >= HIGH_VALUE_DEAL_USD) {
      out.push({
        exceptionType: "high_value_deal",
        severity: "medium",
        dealId: deal.id,
        organizationId: null,
        disputeId: null,
        entityType: "deal",
        entityId: deal.id,
        summary: `Deal ${deal.reference} is a high-value transaction (supplier cost ${costs.supplierCost.toLocaleString()} ${deal.currency}, over this platform's $${HIGH_VALUE_DEAL_USD.toLocaleString()} caution threshold — see lib/verification-levels.ts).`,
        responsibleParty: REVIEW_TEAM,
        deadline: null,
      });
    }

    if (idx >= partiesAssignedIdx) {
      const { tier } = await resolveCorridorTier(deal.origin, deal.destination);
      if (tier === "intelligence") {
        out.push({
          exceptionType: "unproven_corridor_deal",
          severity: "low",
          dealId: deal.id,
          organizationId: null,
          disputeId: null,
          entityType: "deal",
          entityId: deal.id,
          summary: `Deal ${deal.reference} (${deal.origin} → ${deal.destination}) has parties assigned but this corridor has no operational template yet — less institutional knowledge to lean on.`,
          responsibleParty: REVIEW_TEAM,
          deadline: null,
        });
      }
    }

    // A real regression the state machine can't catch on its own: it only
    // checks counterparties_verified AT the moment of that one transition
    // (lib/deal-workflow.ts). A verification that later expires or gets
    // superseded by a failed re-check doesn't retroactively block a deal
    // that already passed that gate — this is the ongoing check for that.
    if (idx > counterpartiesVerifiedIdx) {
      const parties = await db.select().from(dealParties).where(and(eq(dealParties.dealId, deal.id), isNotNull(dealParties.organizationId)));
      for (const party of parties) {
        if (!party.organizationId) continue;
        const { level } = await resolveOrganizationVerificationLevel(party.organizationId);
        if (level < 1) {
          out.push({
            exceptionType: "verification_regression",
            severity: "critical",
            dealId: deal.id,
            organizationId: party.organizationId,
            disputeId: null,
            entityType: "deal_party",
            entityId: party.id,
            summary: `Deal ${deal.reference} already passed "counterparties verified" but party "${party.name || party.role}" (organization #${party.organizationId}) has since dropped below verification level 1 — a re-check or expired verification regression.`,
            responsibleParty: REVIEW_TEAM,
            deadline: null,
          });
        }
      }
    }
  }
  return out;
}

async function detectOverdueDisputes(): Promise<DetectedCondition[]> {
  const db = getDb();
  const now = new Date().toISOString();
  const openStatuses = ["open", "investigating", "awaiting_response"] as const;
  const rows = await db.select().from(disputes).where(and(inArray(disputes.status, [...openStatuses]), isNotNull(disputes.responseDueAt)));
  const overdue = rows.filter((r) => r.responseDueAt && r.responseDueAt < now);
  return overdue.map((row) => ({
    exceptionType: "dispute_overdue" as const,
    severity: (row.priority === "urgent" ? "critical" : row.priority === "high" ? "high" : "medium") as ExceptionSeverity,
    dealId: row.dealId,
    organizationId: null,
    disputeId: row.id,
    entityType: "dispute",
    entityId: row.id,
    summary: `Dispute ${row.reference} (${row.category.replaceAll("_", " ")}) has been past its response deadline (${row.responseDueAt}) since then.`,
    responsibleParty: row.assignedToEmail || REVIEW_TEAM,
    deadline: row.responseDueAt,
  }));
}

async function detectOpenConditions(): Promise<DetectedCondition[]> {
  const results = await Promise.all([
    detectFailedVerificationChecks(),
    detectExpiredVerificationChecks(),
    detectOrganizationVerificationExceptions(),
    detectDocumentExceptions(),
    detectOverdueMilestones(),
    detectDealStageExceptions(),
    detectHighRiskDeals(),
    detectOverdueDisputes(),
  ]);
  return results.flat();
}

export interface SyncResult {
  created: number;
  autoResolved: number;
  totalOpen: number;
}

/**
 * The ONLY writer of the exceptions table. Idempotent and safe to call as
 * often as needed — run by the Cron Trigger (worker/index.ts) AND lazily at
 * the top of GET /api/admin/exceptions, so the queue is never more than one
 * request stale even between cron ticks. Never touches an existing open
 * row's workflow state (status/ownerEmail) — only creates rows for newly
 * detected conditions and auto-resolves rows whose condition cleared.
 */
export async function syncExceptionQueue(): Promise<SyncResult> {
  const db = getDb();
  const detected = await detectOpenConditions();
  const detectedByKey = new Map(detected.map((c) => [dedupeKeyFor(c), c]));

  const existing = await db.select().from(exceptions).where(isNotNull(exceptions.openDedupeKey));
  const existingKeys = new Set(existing.map((e) => e.openDedupeKey as string));

  let created = 0;
  for (const [key, cond] of detectedByKey) {
    if (existingKeys.has(key)) continue;
    try {
      await db.insert(exceptions).values({
        exceptionType: cond.exceptionType,
        severity: cond.severity,
        dealId: cond.dealId,
        organizationId: cond.organizationId,
        disputeId: cond.disputeId,
        entityType: cond.entityType,
        entityId: cond.entityId,
        dedupeKey: key,
        openDedupeKey: key,
        summary: cond.summary,
        responsibleParty: cond.responsibleParty,
        deadline: cond.deadline,
        status: "open",
      });
      created += 1;
    } catch {
      // Unique index on openDedupeKey lost a concurrent race — another
      // sync (another admin's GET, or the Cron Trigger) already inserted
      // this exact condition. Not an error — same reasoning as
      // lib/idempotency.ts's claim/poll protocol.
    }
  }

  const now = new Date().toISOString();
  let autoResolved = 0;
  for (const row of existing) {
    if (row.openDedupeKey && !detectedByKey.has(row.openDedupeKey)) {
      await db
        .update(exceptions)
        .set({
          status: "resolved",
          resolvedAt: now,
          resolvedByEmail: "",
          resolutionSummary: "Automatically resolved — the underlying condition is no longer present.",
          openDedupeKey: null,
          updatedAt: now,
        })
        .where(eq(exceptions.id, row.id));
      autoResolved += 1;
    }
  }

  const openNow = await db.select({ id: exceptions.id }).from(exceptions).where(inArray(exceptions.status, ["open", "in_progress", "dismissed"]));
  return { created, autoResolved, totalOpen: openNow.length };
}
