CREATE TABLE `secure_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_hash` text NOT NULL,
	`purpose` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`created_for_phone` text DEFAULT '' NOT NULL,
	`expires_at` text NOT NULL,
	`first_opened_at` text,
	`open_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `secure_links_token_hash_unique` ON `secure_links` (`token_hash`);--> statement-breakpoint
CREATE TABLE `whatsapp_contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`phone_number` text NOT NULL,
	`linked_email` text DEFAULT '' NOT NULL,
	`consent_at` text,
	`opt_out_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_contacts_phone_number_unique` ON `whatsapp_contacts` (`phone_number`);--> statement-breakpoint
CREATE TABLE `whatsapp_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`phone_number` text NOT NULL,
	`direction` text NOT NULL,
	`message_type` text DEFAULT 'text' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`related_entity_type` text DEFAULT '' NOT NULL,
	`related_entity_id` integer,
	`provider_name` text DEFAULT '' NOT NULL,
	`provider_message_id` text DEFAULT '' NOT NULL,
	`delivery_status` text DEFAULT 'queued' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
