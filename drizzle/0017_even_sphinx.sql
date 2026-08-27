CREATE TABLE `commission_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deal_id` integer NOT NULL,
	`referral_partner_id` integer NOT NULL,
	`attribution_id` integer,
	`basis` text NOT NULL,
	`rate` real,
	`flat_amount` real,
	`currency` text DEFAULT 'USD' NOT NULL,
	`payer_party` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_by_email` text NOT NULL,
	`approved_by_email` text DEFAULT '' NOT NULL,
	`approved_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`referral_partner_id`) REFERENCES `referral_partners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`attribution_id`) REFERENCES `referral_attributions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `referral_attributions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`referral_code` text NOT NULL,
	`referral_partner_id` integer NOT NULL,
	`referee_email` text NOT NULL,
	`market_request_id` integer,
	`deal_id` integer,
	`source` text NOT NULL,
	`is_primary` integer DEFAULT true NOT NULL,
	`fraud_flag` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`referral_partner_id`) REFERENCES `referral_partners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`market_request_id`) REFERENCES `market_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `referral_partners` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`code` text NOT NULL,
	`created_by_email` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `referral_partners_code_unique` ON `referral_partners` (`code`);