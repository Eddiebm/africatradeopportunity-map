CREATE TABLE `corridor_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`corridor_key` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`origin` text NOT NULL,
	`destination` text NOT NULL,
	`product_categories_json` text DEFAULT '[]' NOT NULL,
	`required_buyer_info` text DEFAULT '' NOT NULL,
	`required_supplier_info` text DEFAULT '' NOT NULL,
	`required_documents_json` text DEFAULT '[]' NOT NULL,
	`verification_requirements` text DEFAULT '' NOT NULL,
	`standard_milestones_json` text DEFAULT '[]' NOT NULL,
	`evidence_required_json` text DEFAULT '{}' NOT NULL,
	`approved_partner_roles_json` text DEFAULT '[]' NOT NULL,
	`expected_timing` text DEFAULT '' NOT NULL,
	`cost_components_json` text DEFAULT '[]' NOT NULL,
	`risk_rules` text DEFAULT '' NOT NULL,
	`escalation_rules` text DEFAULT '' NOT NULL,
	`source_attribution` text DEFAULT '' NOT NULL,
	`last_reviewed_at` text,
	`reviewer_email` text DEFAULT '' NOT NULL,
	`confidence` text DEFAULT 'low' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_by_email` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE `deals` ADD `corridor_template_id` integer REFERENCES corridor_templates(id);