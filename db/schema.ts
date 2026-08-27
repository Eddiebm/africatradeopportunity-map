import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// Identity, sessions and platform-level authorization.
//
// Two kinds of role live in this schema:
//  - `users.platformRole`: staff roles that are not scoped to any one
//    organization (administrator, verification analyst). Null for ordinary
//    traders.
//  - `organizationMembers.role`: the marketplace-participant role a user
//    holds within one organization (trader, buyer, supplier, freight
//    provider, inspector, broker, partner institution). A user can belong to
//    more than one organization with different roles in each.
// Every server-side authorization check must read one of these two columns —
// never a client-supplied role, email or id. See lib/auth/current-user.ts.
// ---------------------------------------------------------------------------

export const PLATFORM_ROLES = ["administrator", "verification_analyst"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const ORGANIZATION_ROLES = [
  "trader",
  "buyer",
  "supplier",
  "freight_provider",
  "inspector",
  "broker",
  "partner_institution",
] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull().default(""),
  // Staff-only, organization-independent role. Null for ordinary traders —
  // their capabilities come entirely from organizationMembers.role.
  platformRole: text("platform_role", { enum: PLATFORM_ROLES }),
  emailVerifiedAt: text("email_verified_at"),
  status: text("status").notNull().default("active"), // active | suspended | deleted
  suspendedReason: text("suspended_reason").notNull().default(""),
  locale: text("locale").notNull().default("en"),
  termsAcceptedAt: text("terms_accepted_at"),
  deletionRequestedAt: text("deletion_requested_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const sessions = sqliteTable("sessions", {
  // Random 256-bit id, hex-encoded. The session cookie carries this value
  // plus an HMAC signature; only the signature is secret-dependent, so the
  // id itself is safe to store in plaintext and index on.
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  ip: text("ip").notNull().default(""),
  userAgent: text("user_agent").notNull().default(""),
  revokedAt: text("revoked_at"),
});

export const emailVerificationTokens = sqliteTable("email_verification_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  // SHA-256 hash of the token; the raw token is only ever in the emailed
  // link, never persisted.
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  consumedAt: text("consumed_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const passwordResetTokens = sqliteTable("password_reset_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  consumedAt: text("consumed_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const organizationMembers = sqliteTable("organization_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  userId: integer("user_id").notNull().references(() => users.id),
  role: text("role", { enum: ORGANIZATION_ROLES }).notNull(),
  status: text("status").notNull().default("active"), // invited | active | removed
  invitedByUserId: integer("invited_by_user_id").references(() => users.id),
  invitedEmail: text("invited_email").notNull().default(""),
  invitedAt: text("invited_at"),
  joinedAt: text("joined_at"),
  removedAt: text("removed_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Immutable log of every material administrative decision (approvals,
// rejections, status reversals, suspensions...). Written in addition to —
// never instead of — the entity-specific event tables below
// (dealEvents, disputeEvents, documentAuditEvents), which record normal
// participant activity. This table is specifically for actions taken under
// platform authority, and always requires a reason.
export const adminAuditEvents = sqliteTable("admin_audit_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actorUserId: integer("actor_user_id").notNull().references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  fromStatus: text("from_status").notNull().default(""),
  toStatus: text("to_status").notNull().default(""),
  reason: text("reason").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Lightweight app-layer rate limiting (per key = e.g. "login:<ip>" or
// "register:<ip>"), window-bucketed. This is a defense-in-depth backstop —
// production deployments should also configure Cloudflare's edge Rate
// Limiting / WAF rules, which this table cannot replace and which nothing
// in application code can configure.
export const rateLimitAttempts = sqliteTable("rate_limit_attempts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  bucketKey: text("bucket_key").notNull(),
  windowStart: text("window_start").notNull(),
  count: integer("count").notNull().default(1),
});

export const marketRequests = sqliteTable("market_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerEmail: text("owner_email"),
  // Nullable: a listing can be posted without an organization (kept for
  // backward compatibility with every listing created before Phase 2, and
  // for a signed-in trader who hasn't created/joined an organization yet).
  // Protected introductions (see `introductions` below) require both sides
  // of a match to have one — a listing without one falls back to the
  // original direct-consent flow on `matchCandidates`.
  organizationId: integer("organization_id").references(() => organizations.id),
  role: text("role").notNull(),
  origin: text("origin").notNull(),
  destination: text("destination").notNull(),
  product: text("product").notNull(),
  hsCode: text("hs_code").notNull().default(""),
  volume: text("volume").notNull(),
  targetPrice: text("target_price").notNull().default(""),
  contact: text("contact").notNull(),
  status: text("status").notNull().default("pending_verification"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const organizations = sqliteTable("organizations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerEmail: text("owner_email").notNull(),
  legalName: text("legal_name").notNull(),
  tradingName: text("trading_name").notNull().default(""),
  country: text("country").notNull(),
  registrationNumber: text("registration_number").notNull().default(""),
  phone: text("phone").notNull().default(""),
  verificationStatus: text("verification_status").notNull().default("reported"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const deals = sqliteTable("deals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reference: text("reference").notNull().unique(),
  ownerEmail: text("owner_email").notNull(),
  requestType: text("request_type").notNull(),
  product: text("product").notNull(),
  hsCode: text("hs_code").notNull().default(""),
  origin: text("origin").notNull(),
  destination: text("destination").notNull(),
  quantity: real("quantity").notNull().default(0),
  unit: text("unit").notNull().default("tonnes"),
  currency: text("currency").notNull().default("USD"),
  targetDate: text("target_date").notNull().default(""),
  // Priority 7 (docs/production-readiness.md): one of DEAL_STAGES
  // (lib/deal-workflow.ts) — "request_confirmed" is the first of the
  // mission's 13 stages. The column default below is intentionally left
  // as the pre-Priority-7 literal "intake" rather than changed to
  // "request_confirmed": changing a SQLite column default forces
  // drizzle-kit to recreate this heavily-referenced table (every other
  // deal-scoped table FKs into it), which fails in D1's migration runner
  // — a real, confirmed platform limitation, not a bug in this app's
  // migration. app/api/deals/route.ts's POST sets `stage` explicitly on
  // every insert instead, so this default is realistically never used —
  // documented here so it doesn't look like an oversight.
  stage: text("stage").notNull().default("intake"),
  riskStatus: text("risk_status").notNull().default("unscored"),
  // Priority 5 (docs/production-readiness.md): "Historical deals must
  // retain the corridor-template version under which they were
  // created." corridorTemplates rows are immutable once created — an
  // edit always inserts a new version row (see that table's header
  // comment) — so pointing at a specific row IS pointing at a specific
  // version, permanently, even after a newer version is published.
  // Nullable: most corridors have no template yet (see CORRIDOR_STATUS
  // tiers — "intelligence coverage" is every country with no template at
  // all).
  corridorTemplateId: integer("corridor_template_id").references(() => corridorTemplates.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const dealCosts = sqliteTable("deal_costs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dealId: integer("deal_id").notNull().references(() => deals.id),
  supplierCost: real("supplier_cost").notNull().default(0),
  expectedRevenue: real("expected_revenue").notNull().default(0),
  freight: real("freight").notNull().default(0),
  borderTaxes: real("border_taxes").notNull().default(0),
  inspection: real("inspection").notNull().default(0),
  insurance: real("insurance").notNull().default(0),
  financeFx: real("finance_fx").notNull().default(0),
  lossPercent: real("loss_percent").notNull().default(0),
  contingency: real("contingency").notNull().default(0),
  sourceStatus: text("source_status").notNull().default("reported"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const dealParties = sqliteTable("deal_parties", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dealId: integer("deal_id").notNull().references(() => deals.id),
  organizationId: integer("organization_id").references(() => organizations.id),
  // Reuses ORGANIZATION_ROLES (see above) rather than a parallel enum —
  // a deal party is acting in the same role vocabulary an organization
  // already uses (buyer, supplier, freight_provider, inspector, broker,
  // partner_institution), validated at the app layer in
  // app/api/deals/[id]/parties/route.ts.
  role: text("role").notNull(),
  name: text("name").notNull().default(""),
  contact: text("contact").notNull().default(""),
  // Verification status of this party's own claim (parallels
  // organizations.verificationStatus) — NOT whether they're still on the
  // deal; see removedAt for that, mirroring organizationMembers' own
  // status vs. removedAt split.
  status: text("status").notNull().default("reported"),
  verifiedAt: text("verified_at"),
  assignedByEmail: text("assigned_by_email").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  removedAt: text("removed_at"),
  removedByEmail: text("removed_by_email"),
});

export const verificationChecks = sqliteTable("verification_checks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dealId: integer("deal_id").notNull().references(() => deals.id),
  checkType: text("check_type").notNull(),
  status: text("status").notNull().default("required"),
  method: text("method").notNull().default(""),
  reviewerEmail: text("reviewer_email").notNull().default(""),
  notes: text("notes").notNull().default(""),
  checkedAt: text("checked_at"),
  // Which uploaded file was actually reviewed for this check. Nullable —
  // most checks won't have one until a trader attaches evidence (see
  // app/api/deals/[id]/checks/[checkId]/route.ts). References documentFiles
  // below, so this column has to come after that table is declared.
  evidenceFileId: integer("evidence_file_id").references(() => documentFiles.id),
  // When a "verified" result stops counting as current. Nullable — unset
  // until an admin actually verifies the check (app/api/admin/desk/route.ts).
  // Not wired up by anything yet in this pass; see docs/AUDIT.md follow-ups.
  expiresAt: text("expires_at"),
});

export const dealDocuments = sqliteTable("deal_documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dealId: integer("deal_id").notNull().references(() => deals.id),
  documentType: text("document_type").notNull(),
  status: text("status").notNull().default("required"),
  storageKey: text("storage_key").notNull().default(""),
  fileName: text("file_name").notNull().default(""),
  reportedBy: text("reported_by").notNull().default(""),
  reviewedBy: text("reviewed_by").notNull().default(""),
  reviewedAt: text("reviewed_at"),
});

export const milestones = sqliteTable("milestones", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dealId: integer("deal_id").notNull().references(() => deals.id),
  sequence: integer("sequence").notNull(),
  name: text("name").notNull(),
  percentage: real("percentage").notNull().default(0),
  releaseCondition: text("release_condition").notNull(),
  status: text("status").notNull().default("proposed"),
  evidenceStatus: text("evidence_status").notNull().default("missing"),
});

export const dealEvents = sqliteTable("deal_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dealId: integer("deal_id").notNull().references(() => deals.id),
  actorEmail: text("actor_email").notNull(),
  eventType: text("event_type").notNull(),
  summary: text("summary").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const documentFiles = sqliteTable("document_files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dealDocumentId: integer("deal_document_id").notNull().references(() => dealDocuments.id),
  dealId: integer("deal_id").notNull().references(() => deals.id),
  uploaderEmail: text("uploader_email").notNull(),
  storageKey: text("storage_key").notNull().unique(),
  originalName: text("original_name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  fileStatus: text("file_status").notNull().default("active"),
  uploadedAt: text("uploaded_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  deletedAt: text("deleted_at"),
  retentionUntil: text("retention_until"),
  legalHold: integer("legal_hold", { mode: "boolean" }).notNull().default(false),
});

export const documentAuditEvents = sqliteTable("document_audit_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  documentFileId: integer("document_file_id").notNull().references(() => documentFiles.id),
  dealId: integer("deal_id").notNull().references(() => deals.id),
  actorEmail: text("actor_email").notNull(),
  action: text("action").notNull(),
  details: text("details").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const matchCandidates = sqliteTable("match_candidates", {
  id: text("id").primaryKey(),
  demandRequestId: integer("demand_request_id").notNull().references(() => marketRequests.id),
  supplyRequestId: integer("supply_request_id").notNull().references(() => marketRequests.id),
  freightRequestId: integer("freight_request_id").references(() => marketRequests.id),
  score: real("score").notNull(),
  scoreVersion: text("score_version").notNull().default("v1"),
  scoreBreakdown: text("score_breakdown").notNull().default("{}"),
  status: text("status").notNull().default("suggested"),
  demandInterestAt: text("demand_interest_at"),
  supplyInterestAt: text("supply_interest_at"),
  expiresAt: text("expires_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const quoteRequests = sqliteTable("quote_requests", {
  id: text("id").primaryKey(),
  matchId: text("match_id").references(() => matchCandidates.id),
  dealId: integer("deal_id").references(() => deals.id),
  requesterOrganizationId: integer("requester_organization_id").notNull().references(() => organizations.id),
  recipientOrganizationId: integer("recipient_organization_id").notNull().references(() => organizations.id),
  quoteType: text("quote_type").notNull(),
  status: text("status").notNull().default("requested"),
  requirements: text("requirements").notNull().default("{}"),
  dueAt: text("due_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const quotes = sqliteTable("quotes", {
  id: text("id").primaryKey(),
  quoteRequestId: text("quote_request_id").notNull().references(() => quoteRequests.id),
  submittedByOrganizationId: integer("submitted_by_organization_id").notNull().references(() => organizations.id),
  currency: text("currency").notNull(),
  unitPrice: real("unit_price").notNull().default(0),
  quantity: real("quantity").notNull().default(0),
  unit: text("unit").notNull().default(""),
  goodsTotal: real("goods_total").notNull().default(0),
  freightTotal: real("freight_total").notNull().default(0),
  borderEstimate: real("border_estimate").notNull().default(0),
  inspectionTotal: real("inspection_total").notNull().default(0),
  insuranceTotal: real("insurance_total").notNull().default(0),
  financeFxTotal: real("finance_fx_total").notNull().default(0),
  otherTotal: real("other_total").notNull().default(0),
  inclusions: text("inclusions").notNull().default("[]"),
  exclusions: text("exclusions").notNull().default("[]"),
  assumptions: text("assumptions").notNull().default(""),
  validUntil: text("valid_until").notNull(),
  sourceStatus: text("source_status").notNull().default("party_reported"),
  status: text("status").notNull().default("submitted"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const introductions = sqliteTable("introductions", {
  id: text("id").primaryKey(),
  matchId: text("match_id").notNull().references(() => matchCandidates.id),
  demandOrganizationId: integer("demand_organization_id").notNull().references(() => organizations.id),
  supplyOrganizationId: integer("supply_organization_id").notNull().references(() => organizations.id),
  demandConsentAt: text("demand_consent_at"),
  supplyConsentAt: text("supply_consent_at"),
  approvedBy: text("approved_by").notNull().default(""),
  approvedAt: text("approved_at"),
  contactReleasedAt: text("contact_released_at"),
  status: text("status").notNull().default("awaiting_consent"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const disputes = sqliteTable("disputes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reference: text("reference").notNull().unique(),
  dealId: integer("deal_id").notNull().references(() => deals.id),
  openedByEmail: text("opened_by_email").notNull(),
  respondentEmail: text("respondent_email").notNull().default(""),
  category: text("category").notNull(),
  description: text("description").notNull(),
  requestedResolution: text("requested_resolution").notNull().default(""),
  disputedAmount: real("disputed_amount").notNull().default(0),
  currency: text("currency").notNull().default("USD"),
  status: text("status").notNull().default("open"),
  priority: text("priority").notNull().default("normal"),
  assignedToEmail: text("assigned_to_email").notNull().default(""),
  responseDueAt: text("response_due_at"),
  resolvedAt: text("resolved_at"),
  resolutionSummary: text("resolution_summary").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const disputeMessages = sqliteTable("dispute_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  disputeId: integer("dispute_id").notNull().references(() => disputes.id),
  authorEmail: text("author_email").notNull(),
  audience: text("audience").notNull().default("parties"),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const disputeEvents = sqliteTable("dispute_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  disputeId: integer("dispute_id").notNull().references(() => disputes.id),
  actorEmail: text("actor_email").notNull(),
  eventType: text("event_type").notNull(),
  fromStatus: text("from_status").notNull().default(""),
  toStatus: text("to_status").notNull().default(""),
  summary: text("summary").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ---------------------------------------------------------------------------
// Trade intelligence persistence (Phase 4). Every figure the Opportunity
// Finder or the country-level ImportIntelligence panel shows must trace back
// to one of these rows — never a number invented for a hypothetical
// candidate. Two layers:
//  - sourceRecords: one row per official datapoint actually used (a single
//    year's import value, a single supplier's share, a World Bank
//    indicator reading...) with full provenance — source org, source URL,
//    reporting/partner country, period, evidence category, retrieval date.
//    This is the audit trail: "what did we look at, and when."
//  - tradeIntelligenceSnapshots: the full computed response for one
//    (country, hsCode) pair, cached so a repeat lookup — or the
//    Opportunity Finder scoring many candidates at once — doesn't refetch
//    UN Comtrade/World Bank on every request. Refreshed by
//    lib/trade-intelligence.ts, both on-demand (a live user lookup that
//    finds a stale/missing cache) and by the Cron Trigger in
//    worker/index.ts working through intelligenceWatchlist.
// ---------------------------------------------------------------------------

export const EVIDENCE_CATEGORIES = ["official", "mirror_reported", "market_reported", "estimated", "forecast"] as const;
export type EvidenceCategory = (typeof EVIDENCE_CATEGORIES)[number];

export const sourceRecords = sqliteTable("source_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceOrganization: text("source_organization").notNull(),
  sourceUrl: text("source_url").notNull(),
  reportingCountry: text("reporting_country").notNull(),
  partnerCountry: text("partner_country").notNull().default(""), // "" = world / all partners
  hsCode: text("hs_code").notNull().default(""),
  period: text("period").notNull(),
  metric: text("metric").notNull(), // e.g. "import_value_usd", "population_growth_pct"
  value: real("value").notNull().default(0),
  unit: text("unit").notNull().default(""),
  evidenceCategory: text("evidence_category", { enum: EVIDENCE_CATEGORIES }).notNull(),
  confidence: integer("confidence"), // 0-100, forecasts only
  methodology: text("methodology").notNull().default(""),
  limitations: text("limitations").notNull().default(""),
  retrievedAt: text("retrieved_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const tradeIntelligenceSnapshots = sqliteTable("trade_intelligence_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  country: text("country").notNull(),
  hsCode: text("hs_code").notNull(),
  responseJson: text("response_json").notNull(),
  retrievedAt: text("retrieved_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Seeded corridor/product pairs the Cron Trigger keeps refreshed, so the
// Opportunity Finder has real cached demand signal to rank against instead
// of needing a live Comtrade call per candidate per request. A pair earns
// a permanent spot the first time any user actually looks it up (see
// lib/trade-intelligence.ts) — this is a cache-warming list driven by real
// demand, not a hand-picked "opportunities" list dressed up as data.
export const intelligenceWatchlist = sqliteTable("intelligence_watchlist", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  country: text("country").notNull(),
  hsCode: text("hs_code").notNull(),
  lastRefreshedAt: text("last_refreshed_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const notifications = sqliteTable("notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  recipientEmail: text("recipient_email").notNull(),
  eventType: text("event_type").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  locale: text("locale").notNull().default("en"),
  titleKey: text("title_key").notNull(),
  bodyKey: text("body_key").notNull(),
  payloadJson: text("payload_json").notNull().default("{}"),
  channel: text("channel").notNull().default("in_app"),
  status: text("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error").notNull().default(""),
  readAt: text("read_at"),
  sentAt: text("sent_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Priority 2 (docs/production-readiness.md): "Audit logging for sensitive
// actions." adminAuditEvents covers admin-desk decisions,
// documentAuditEvents/dealEvents/disputeEvents cover deal activity — but
// nothing logged *authentication* events (who signed in, from where, when,
// or failed to). This closes that gap. Deliberately minimal fields: email
// + ip + user agent + a short details string, NEVER a password, token, or
// session id — see lib/auth/security-events.ts's header for the full
// rationale (this table is designed to be safe to hand to a human
// investigating an incident without itself becoming a new secret to leak).
export const SECURITY_EVENT_TYPES = [
  "login_success",
  "login_failed",
  "logout",
  "register",
  "password_reset_requested",
  "password_reset_completed",
] as const;
export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

export const securityEvents = sqliteTable("security_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventType: text("event_type").notNull(),
  email: text("email").notNull().default(""),
  ip: text("ip").notNull().default(""),
  userAgent: text("user_agent").notNull().default(""),
  details: text("details").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Priority 3 (docs/production-readiness.md): "Cron-run history" +
// "Cron failure visibility." Before this, the daily intelligence-watchlist
// refresh (worker/index.ts's scheduled() handler) only ever
// console.log'd its outcome — visible for as long as a `wrangler tail`
// session happens to be open, and nowhere else. This persists every run
// so "did last night's refresh actually happen, and did it succeed?" is
// a query, not a hope that someone was tailing logs at 3am.
export const cronRuns = sqliteTable("cron_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobName: text("job_name").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  status: text("status").notNull().default("running"), // running | success | failed
  refreshedCount: integer("refreshed_count"),
  failedCount: integer("failed_count"),
  errorMessage: text("error_message"),
});

// docs/AUDIT.md §5 item 8: "No idempotency keys on deal creation, dispute
// creation, or match interest — a retried POST creates a duplicate
// deal/dispute record." (Match interest was actually already safe — see
// lib/idempotency.ts's header comment — this table covers the routes that
// weren't: deal and dispute creation.) A client sends an Idempotency-Key
// header once per logical user action; a retry of the exact same request
// (double-click, a network retry, a client resubmitting after a timeout it
// never actually saw the response to) replays the stored response instead
// of re-executing the mutation. Scoped per-user + per-endpoint, not
// globally, so two different users — or the same user acting on two
// different endpoints — can never collide on the same key.
//
// `status` exists (rather than just writing responseStatus/responseBody
// once, after the handler runs) because a select-then-insert check alone
// has a real race: two concurrent requests with the same key can both see
// "no row yet" and both run the mutation before either finishes writing.
// The unique index below is what actually closes that race — a request
// claims a key by INSERTing a 'pending' row (the unique index makes only
// one concurrent insert win), runs its mutation, then UPDATEs the row to
// 'completed'. A request that loses the insert race polls this row until
// it flips to 'completed' and replays it, instead of running the mutation
// itself. See lib/idempotency.ts for the full protocol.
export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull().references(() => users.id),
    endpoint: text("endpoint").notNull(),
    key: text("key").notNull(),
    status: text("status").notNull().default("pending"), // pending | completed
    responseStatus: integer("response_status"),
    responseBody: text("response_body"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    completedAt: text("completed_at"),
  },
  (table) => ({
    userEndpointKey: uniqueIndex("idempotency_keys_user_endpoint_key").on(table.userId, table.endpoint, table.key),
  }),
);

// Priority 5 (docs/production-readiness.md): "Create explicit
// distinctions between: Intelligence coverage / Operationally supported
// corridors / TradeSafe Verified corridors." All 54 countries already
// have intelligence coverage (the existing Opportunity
// Finder/import-intelligence work) — that tier needs no table, it's just
// "every country." A corridor becomes "operationally supported" the
// moment ANY template row exists for it (draft or reviewed), and
// "TradeSafe Verified" specifically when a template's status is
// 'operational'. See lib/corridor-templates.ts for the tier-resolution
// logic and app/corridors/page.tsx for where this distinction is surfaced.
//
// IMMUTABLE VERSIONING: a template is never UPDATEd in place. Editing one
// means inserting a new row with the same corridorKey and version+1 —
// this is what makes db/schema.ts's deals.corridorTemplateId a genuine,
// permanent historical record ("what rules applied when this deal was
// created") rather than a pointer that silently changes meaning under
// a deal that's already in flight.
export const CORRIDOR_TEMPLATE_STATUSES = ["draft", "reviewed", "operational", "suspended"] as const;
export type CorridorTemplateStatus = (typeof CORRIDOR_TEMPLATE_STATUSES)[number];
export const CORRIDOR_TEMPLATE_CONFIDENCE = ["low", "medium", "high"] as const;
export type CorridorTemplateConfidence = (typeof CORRIDOR_TEMPLATE_CONFIDENCE)[number];

export const corridorTemplates = sqliteTable("corridor_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // Groups every version of "the same" corridor together — a plain,
  // stable string (e.g. "GH-NG") rather than a separate lookup table,
  // matching this schema's existing preference for simple text keys over
  // extra join tables where nothing else needs to reference the group
  // itself (see e.g. dealParties.role reusing ORGANIZATION_ROLES as a
  // vocabulary instead of a table).
  corridorKey: text("corridor_key").notNull(),
  version: integer("version").notNull().default(1),
  origin: text("origin").notNull(),
  destination: text("destination").notNull(),
  productCategoriesJson: text("product_categories_json").notNull().default("[]"),
  requiredBuyerInfo: text("required_buyer_info").notNull().default(""),
  requiredSupplierInfo: text("required_supplier_info").notNull().default(""),
  requiredDocumentsJson: text("required_documents_json").notNull().default("[]"),
  verificationRequirements: text("verification_requirements").notNull().default(""),
  // [{name, percentage, releaseCondition}, ...] — same shape as
  // db/schema.ts's milestones table, deliberately: a real deal's
  // milestones (app/api/deals/route.ts's POST) are meant to eventually
  // be seeded FROM the matching template's standardMilestonesJson rather
  // than the current hardcoded four-milestone default, once a corridor
  // actually has a reviewed template — not wired yet (see remaining
  // risks in docs/production-readiness.md), the schema is ready for it.
  standardMilestonesJson: text("standard_milestones_json").notNull().default("[]"),
  evidenceRequiredJson: text("evidence_required_json").notNull().default("{}"),
  // Reuses ORGANIZATION_ROLES (see near the top of this file) — the same
  // vocabulary dealParties.role already uses.
  approvedPartnerRolesJson: text("approved_partner_roles_json").notNull().default("[]"),
  expectedTiming: text("expected_timing").notNull().default(""),
  // [{component, typicalRange, source}, ...] — Priority 12 (landed-cost
  // accuracy) is the natural consumer of this once that priority is
  // built; not wired together yet.
  costComponentsJson: text("cost_components_json").notNull().default("[]"),
  riskRules: text("risk_rules").notNull().default(""),
  escalationRules: text("escalation_rules").notNull().default(""),
  // Where these rules actually came from — never optional in spirit
  // (defaults to "" only because SQLite has no way to enforce "must be
  // filled in before status can leave draft" at the column level; that
  // check belongs in the API layer, see app/api/admin/corridor-templates/route.ts).
  sourceAttribution: text("source_attribution").notNull().default(""),
  lastReviewedAt: text("last_reviewed_at"),
  reviewerEmail: text("reviewer_email").notNull().default(""),
  confidence: text("confidence").notNull().default("low"),
  status: text("status").notNull().default("draft"),
  createdByEmail: text("created_by_email").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Priority 6 (docs/production-readiness.md): "Implement transparent
// verification levels." Deliberately a SEPARATE concept from
// verificationChecks above — that table tracks per-deal, transaction-
// specific checks (identity, buyer_authority, stock, ...); this tracks an
// ORGANIZATION's standing facts (is this entity who it says it is, does
// it actually have the business registration it claims) that persist
// across many deals, not just one. The six levels are a progression —
// see resolveOrganizationVerificationLevel in
// lib/verification-levels.ts for exactly how "current level" is computed
// from these rows (append-only, never updated in place — same
// immutability discipline as corridor_templates above, for the same
// reason: an audit history that could be silently edited isn't an audit
// history).
export const VERIFICATION_LEVELS = [
  "identity",
  "business_registration",
  "address_bank_ownership",
  "capability_inventory",
  "independent_inspection",
  "transaction_history",
] as const;
export type VerificationLevelKey = (typeof VERIFICATION_LEVELS)[number];

export const organizationVerifications = sqliteTable("organization_verifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  levelKey: text("level_key").notNull(), // one of VERIFICATION_LEVELS
  whatWasChecked: text("what_was_checked").notNull().default(""),
  performedByEmail: text("performed_by_email").notNull().default(""),
  evidenceFileId: integer("evidence_file_id").references(() => documentFiles.id),
  source: text("source").notNull().default(""),
  checkedAt: text("checked_at"),
  expiresAt: text("expires_at"),
  result: text("result").notNull().default("pending"), // pending | passed | failed
  reviewerEmail: text("reviewer_email").notNull().default(""),
  notes: text("notes").notNull().default(""),
  // Per docs/AUDIT.md's AI boundary ("AI may extract, compare, summarize,
  // and flag evidence. AI must not make final ... verification ...
  // decisions"): true by default — an automated/AI-assisted check
  // NEVER counts as 'passed' on its own without a human reviewer
  // actually setting this false after confirming the result themselves.
  // See app/api/admin/organization-verifications/route.ts for where this
  // is enforced, not just documented.
  humanReviewRequired: integer("human_review_required", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
