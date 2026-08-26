CREATE TABLE `market_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`role` text NOT NULL,
	`origin` text NOT NULL,
	`destination` text NOT NULL,
	`product` text NOT NULL,
	`hs_code` text DEFAULT '' NOT NULL,
	`volume` text NOT NULL,
	`target_price` text DEFAULT '' NOT NULL,
	`contact` text NOT NULL,
	`status` text DEFAULT 'pending_verification' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
