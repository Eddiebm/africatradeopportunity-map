import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const marketRequests = sqliteTable("market_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerEmail: text("owner_email"),
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
  stage: text("stage").notNull().default("intake"),
  riskStatus: text("risk_status").notNull().default("unscored"),
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
  role: text("role").notNull(),
  name: text("name").notNull().default(""),
  contact: text("contact").notNull().default(""),
  status: text("status").notNull().default("reported"),
  verifiedAt: text("verified_at"),
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
