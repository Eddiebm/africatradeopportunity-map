CREATE TABLE `deal_costs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deal_id` integer NOT NULL,
	`supplier_cost` real DEFAULT 0 NOT NULL,
	`expected_revenue` real DEFAULT 0 NOT NULL,
	`freight` real DEFAULT 0 NOT NULL,
	`border_taxes` real DEFAULT 0 NOT NULL,
	`inspection` real DEFAULT 0 NOT NULL,
	`insurance` real DEFAULT 0 NOT NULL,
	`finance_fx` real DEFAULT 0 NOT NULL,
	`loss_percent` real DEFAULT 0 NOT NULL,
	`contingency` real DEFAULT 0 NOT NULL,
	`source_status` text DEFAULT 'reported' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `deal_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deal_id` integer NOT NULL,
	`document_type` text NOT NULL,
	`status` text DEFAULT 'required' NOT NULL,
	`storage_key` text DEFAULT '' NOT NULL,
	`file_name` text DEFAULT '' NOT NULL,
	`reported_by` text DEFAULT '' NOT NULL,
	`reviewed_by` text DEFAULT '' NOT NULL,
	`reviewed_at` text,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `deal_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deal_id` integer NOT NULL,
	`actor_email` text NOT NULL,
	`event_type` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `deal_parties` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deal_id` integer NOT NULL,
	`organization_id` integer,
	`role` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`contact` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'reported' NOT NULL,
	`verified_at` text,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `deals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reference` text NOT NULL,
	`owner_email` text NOT NULL,
	`request_type` text NOT NULL,
	`product` text NOT NULL,
	`hs_code` text DEFAULT '' NOT NULL,
	`origin` text NOT NULL,
	`destination` text NOT NULL,
	`quantity` real DEFAULT 0 NOT NULL,
	`unit` text DEFAULT 'tonnes' NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`target_date` text DEFAULT '' NOT NULL,
	`stage` text DEFAULT 'intake' NOT NULL,
	`risk_status` text DEFAULT 'unscored' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deals_reference_unique` ON `deals` (`reference`);--> statement-breakpoint
CREATE TABLE `milestones` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deal_id` integer NOT NULL,
	`sequence` integer NOT NULL,
	`name` text NOT NULL,
	`percentage` real DEFAULT 0 NOT NULL,
	`release_condition` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`evidence_status` text DEFAULT 'missing' NOT NULL,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_email` text NOT NULL,
	`legal_name` text NOT NULL,
	`trading_name` text DEFAULT '' NOT NULL,
	`country` text NOT NULL,
	`registration_number` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`verification_status` text DEFAULT 'reported' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `verification_checks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deal_id` integer NOT NULL,
	`check_type` text NOT NULL,
	`status` text DEFAULT 'required' NOT NULL,
	`method` text DEFAULT '' NOT NULL,
	`reviewer_email` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`checked_at` text,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE no action
);
