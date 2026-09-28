CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `tenants` (`id`, `name`, `created_at`)
VALUES ('tnt_default', 'Standard', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));--> statement-breakpoint
CREATE TABLE `user_tenants` (
	`user_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `tenant_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `user_tenants_tenant_id_idx` ON `user_tenants` (`tenant_id`);--> statement-breakpoint
INSERT INTO `user_tenants` (`user_id`, `tenant_id`)
SELECT `id`, 'tnt_default' FROM `users`;--> statement-breakpoint
ALTER TABLE `stocks` ADD `tenant_id` text DEFAULT 'tnt_default' NOT NULL;--> statement-breakpoint
DROP TABLE `user_stock_access`;
