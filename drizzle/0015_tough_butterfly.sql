ALTER TABLE `market_requests` ADD `quantity` real;--> statement-breakpoint
ALTER TABLE `market_requests` ADD `unit` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `market_requests` ADD `product_spec` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `market_requests` ADD `required_delivery_date` text;--> statement-breakpoint
ALTER TABLE `market_requests` ADD `existing_quote_note` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `market_requests` ADD `preferred_contact_method` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `market_requests` ADD `consent_at` text;