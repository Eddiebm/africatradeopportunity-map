CREATE TABLE `dispute_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dispute_id` integer NOT NULL,
	`actor_email` text NOT NULL,
	`event_type` text NOT NULL,
	`from_status` text DEFAULT '' NOT NULL,
	`to_status` text DEFAULT '' NOT NULL,
	`summary` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`dispute_id`) REFERENCES `disputes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `dispute_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dispute_id` integer NOT NULL,
	`author_email` text NOT NULL,
	`audience` text DEFAULT 'parties' NOT NULL,
	`body` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`dispute_id`) REFERENCES `disputes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `disputes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reference` text NOT NULL,
	`deal_id` integer NOT NULL,
	`opened_by_email` text NOT NULL,
	`respondent_email` text DEFAULT '' NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`requested_resolution` text DEFAULT '' NOT NULL,
	`disputed_amount` real DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`assigned_to_email` text DEFAULT '' NOT NULL,
	`response_due_at` text,
	`resolved_at` text,
	`resolution_summary` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `disputes_reference_unique` ON `disputes` (`reference`);--> statement-breakpoint
CREATE TABLE `document_audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_file_id` integer NOT NULL,
	`deal_id` integer NOT NULL,
	`actor_email` text NOT NULL,
	`action` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`document_file_id`) REFERENCES `document_files`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `document_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deal_document_id` integer NOT NULL,
	`deal_id` integer NOT NULL,
	`uploader_email` text NOT NULL,
	`storage_key` text NOT NULL,
	`original_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`file_status` text DEFAULT 'active' NOT NULL,
	`uploaded_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text,
	`retention_until` text,
	`legal_hold` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`deal_document_id`) REFERENCES `deal_documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_files_storage_key_unique` ON `document_files` (`storage_key`);--> statement-breakpoint
CREATE TABLE `introductions` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`demand_organization_id` integer NOT NULL,
	`supply_organization_id` integer NOT NULL,
	`demand_consent_at` text,
	`supply_consent_at` text,
	`approved_by` text DEFAULT '' NOT NULL,
	`approved_at` text,
	`contact_released_at` text,
	`status` text DEFAULT 'awaiting_consent' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `match_candidates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`demand_organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supply_organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `match_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`demand_request_id` integer NOT NULL,
	`supply_request_id` integer NOT NULL,
	`freight_request_id` integer,
	`score` real NOT NULL,
	`score_version` text DEFAULT 'v1' NOT NULL,
	`score_breakdown` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'suggested' NOT NULL,
	`demand_interest_at` text,
	`supply_interest_at` text,
	`expires_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`demand_request_id`) REFERENCES `market_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supply_request_id`) REFERENCES `market_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`freight_request_id`) REFERENCES `market_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recipient_email` text NOT NULL,
	`event_type` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL,
	`title_key` text NOT NULL,
	`body_key` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`channel` text DEFAULT 'in_app' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`read_at` text,
	`sent_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `quote_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text,
	`deal_id` integer,
	`requester_organization_id` integer NOT NULL,
	`recipient_organization_id` integer NOT NULL,
	`quote_type` text NOT NULL,
	`status` text DEFAULT 'requested' NOT NULL,
	`requirements` text DEFAULT '{}' NOT NULL,
	`due_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `match_candidates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requester_organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient_organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_request_id` text NOT NULL,
	`submitted_by_organization_id` integer NOT NULL,
	`currency` text NOT NULL,
	`unit_price` real DEFAULT 0 NOT NULL,
	`quantity` real DEFAULT 0 NOT NULL,
	`unit` text DEFAULT '' NOT NULL,
	`goods_total` real DEFAULT 0 NOT NULL,
	`freight_total` real DEFAULT 0 NOT NULL,
	`border_estimate` real DEFAULT 0 NOT NULL,
	`inspection_total` real DEFAULT 0 NOT NULL,
	`insurance_total` real DEFAULT 0 NOT NULL,
	`finance_fx_total` real DEFAULT 0 NOT NULL,
	`other_total` real DEFAULT 0 NOT NULL,
	`inclusions` text DEFAULT '[]' NOT NULL,
	`exclusions` text DEFAULT '[]' NOT NULL,
	`assumptions` text DEFAULT '' NOT NULL,
	`valid_until` text NOT NULL,
	`source_status` text DEFAULT 'party_reported' NOT NULL,
	`status` text DEFAULT 'submitted' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`quote_request_id`) REFERENCES `quote_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitted_by_organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
