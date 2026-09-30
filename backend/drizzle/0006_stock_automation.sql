CREATE TABLE `stock_automation` (
	`stock_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`delta_on_k` real DEFAULT 10 NOT NULL,
	`delta_off_k` real DEFAULT 2 NOT NULL,
	`max_outdoor_humidity_pct` real DEFAULT 80 NOT NULL,
	`target_temp_c` real DEFAULT 12,
	`target_hysteresis_k` real DEFAULT 1 NOT NULL,
	`min_run_minutes` integer DEFAULT 30 NOT NULL,
	`min_pause_minutes` integer DEFAULT 30 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`stock_id`) REFERENCES `stocks`(`id`) ON UPDATE no action ON DELETE cascade
);
