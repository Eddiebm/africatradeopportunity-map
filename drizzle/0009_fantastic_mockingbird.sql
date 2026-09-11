ALTER TABLE `deal_parties` ADD `assigned_by_email` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `deal_parties` ADD `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL;--> statement-breakpoint
ALTER TABLE `deal_parties` ADD `removed_at` text;--> statement-breakpoint
ALTER TABLE `deal_parties` ADD `removed_by_email` text;