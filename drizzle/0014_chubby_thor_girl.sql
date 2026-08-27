CREATE TABLE `exceptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exception_type` text NOT NULL,
	`severity` text NOT NULL,
	`deal_id` integer,
	`organization_id` integer,
	`dispute_id` integer,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`dedupe_key` text NOT NULL,
	`open_dedupe_key` text,
	`summary` text NOT NULL,
	`responsible_party` text DEFAULT '' NOT NULL,
	`owner_email` text DEFAULT '' NOT NULL,
	`deadline` text,
	`status` text DEFAULT 'open' NOT NULL,
	`detected_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`resolved_at` text,
	`resolved_by_email` text DEFAULT '' NOT NULL,
	`resolution_summary` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`dispute_id`) REFERENCES `disputes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exceptions_open_dedupe_key_idx` ON `exceptions` (`open_dedupe_key`);--> statement-breakpoint
ALTER TABLE `milestones` ADD `due_at` text;--> statement-breakpoint
ALTER TABLE `milestones` ADD `created_at` text;