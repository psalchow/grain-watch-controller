CREATE TABLE `fan_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`stock_id` text NOT NULL,
	`ts` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text,
	`source` text NOT NULL,
	FOREIGN KEY (`stock_id`) REFERENCES `stocks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `fan_events_stock_ts_idx` ON `fan_events` (`stock_id`,`ts`);--> statement-breakpoint
CREATE TABLE `fan_state` (
	`stock_id` text PRIMARY KEY NOT NULL,
	`desired_on` integer DEFAULT false NOT NULL,
	`since` text,
	`last_command_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`stock_id`) REFERENCES `stocks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `stocks` ADD `fan_control_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `stocks` ADD `fan_topic_prefix` text;--> statement-breakpoint
ALTER TABLE `stocks` ADD `fan_switch_id` integer DEFAULT 0 NOT NULL;