ALTER TABLE `stocks` DROP COLUMN `device_prefix`;--> statement-breakpoint
ALTER TABLE `stocks` ADD COLUMN `device_group_tmp` text;--> statement-breakpoint
UPDATE `stocks` SET `device_group_tmp` = `device_group`;--> statement-breakpoint
ALTER TABLE `stocks` DROP COLUMN `device_group`;--> statement-breakpoint
ALTER TABLE `stocks` ADD COLUMN `device_group` text;--> statement-breakpoint
UPDATE `stocks` SET `device_group` = `device_group_tmp`;--> statement-breakpoint
ALTER TABLE `stocks` DROP COLUMN `device_group_tmp`;
