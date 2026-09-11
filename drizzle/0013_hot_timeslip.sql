CREATE TABLE `organization_verifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`level_key` text NOT NULL,
	`what_was_checked` text DEFAULT '' NOT NULL,
	`performed_by_email` text DEFAULT '' NOT NULL,
	`evidence_file_id` integer,
	`source` text DEFAULT '' NOT NULL,
	`checked_at` text,
	`expires_at` text,
	`result` text DEFAULT 'pending' NOT NULL,
	`reviewer_email` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`human_review_required` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`evidence_file_id`) REFERENCES `document_files`(`id`) ON UPDATE no action ON DELETE no action
);
