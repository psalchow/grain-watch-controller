ALTER TABLE `stocks` ADD `outdoor_device` text;--> statement-breakpoint
-- Until now the device group selected the grain thermometers and the outdoor
-- sensor alike, so every existing stock keeps exactly its current behaviour.
UPDATE `stocks` SET `outdoor_device` = `device_group`;
