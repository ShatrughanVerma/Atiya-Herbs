-- AlterTable
ALTER TABLE `doctors` ADD COLUMN `system` VARCHAR(30) NULL,
    ADD COLUMN `concerns` JSON NULL;
