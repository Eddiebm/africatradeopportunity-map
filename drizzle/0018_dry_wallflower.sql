CREATE TABLE `landed_cost_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deal_id` integer NOT NULL,
	`component_type` text NOT NULL,
	`phase` text NOT NULL,
	`low_amount` real,
	`expected_amount` real NOT NULL,
	`high_amount` real,
	`currency` text DEFAULT 'USD' NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`source_date` text,
	`confidence` text DEFAULT 'low' NOT NULL,
	`assumptions` text DEFAULT '' NOT NULL,
	`is_excluded` integer DEFAULT false NOT NULL,
	`recorded_by_email` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE no action
);
