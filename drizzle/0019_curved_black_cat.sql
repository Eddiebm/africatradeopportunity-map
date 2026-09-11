CREATE TABLE `account_deletion_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`requested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`scheduled_for` text,
	`held_reason` text DEFAULT '' NOT NULL,
	`decided_by_email` text DEFAULT '' NOT NULL,
	`decided_at` text,
	`decision_reason` text DEFAULT '' NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
