ALTER TABLE `verification_checks` ADD `evidence_file_id` integer REFERENCES document_files(id);--> statement-breakpoint
ALTER TABLE `verification_checks` ADD `expires_at` text;