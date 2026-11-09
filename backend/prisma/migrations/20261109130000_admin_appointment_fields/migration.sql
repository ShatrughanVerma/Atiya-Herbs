-- Staff fields on appointments
ALTER TABLE `appointments` ADD COLUMN `adminNote` VARCHAR(500) NULL,
    ADD COLUMN `cancelReason` VARCHAR(200) NULL,
    ADD COLUMN `completedAt` DATETIME(3) NULL;
