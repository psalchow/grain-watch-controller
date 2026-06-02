CREATE TABLE `stocks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`device_count` integer NOT NULL,
	`device_group` text NOT NULL,
	`device_prefix` text NOT NULL,
	`has_humidity` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_stock_access` (
	`user_id` text NOT NULL,
	`stock_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `stock_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_stock_access_stock_id_idx` ON `user_stock_access` (`stock_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`email` text,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);