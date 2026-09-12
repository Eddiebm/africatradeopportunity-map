CREATE TABLE `price_observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`observed_at` text NOT NULL,
	`source` text NOT NULL,
	`instrument` text NOT NULL,
	`hs_code` text DEFAULT '' NOT NULL,
	`origin` text DEFAULT '' NOT NULL,
	`destination` text DEFAULT '' NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`unit` text NOT NULL,
	`value` real NOT NULL,
	`period` text DEFAULT '' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`confidence` text DEFAULT 'official' NOT NULL,
	`raw_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `price_latest` (
	`key` text PRIMARY KEY NOT NULL,
	`instrument` text NOT NULL,
	`hs_code` text DEFAULT '' NOT NULL,
	`origin` text DEFAULT '' NOT NULL,
	`destination` text DEFAULT '' NOT NULL,
	`value` real NOT NULL,
	`unit` text NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`source` text NOT NULL,
	`period` text DEFAULT '' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`confidence` text DEFAULT 'official' NOT NULL,
	`as_of` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `price_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text DEFAULT 'running' NOT NULL,
	`summary_json` text DEFAULT '{}' NOT NULL
);
