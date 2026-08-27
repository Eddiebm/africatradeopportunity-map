CREATE TABLE `intelligence_watchlist` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`country` text NOT NULL,
	`hs_code` text NOT NULL,
	`last_refreshed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_organization` text NOT NULL,
	`source_url` text NOT NULL,
	`reporting_country` text NOT NULL,
	`partner_country` text DEFAULT '' NOT NULL,
	`hs_code` text DEFAULT '' NOT NULL,
	`period` text NOT NULL,
	`metric` text NOT NULL,
	`value` real DEFAULT 0 NOT NULL,
	`unit` text DEFAULT '' NOT NULL,
	`evidence_category` text NOT NULL,
	`confidence` integer,
	`methodology` text DEFAULT '' NOT NULL,
	`limitations` text DEFAULT '' NOT NULL,
	`retrieved_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trade_intelligence_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`country` text NOT NULL,
	`hs_code` text NOT NULL,
	`response_json` text NOT NULL,
	`retrieved_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
