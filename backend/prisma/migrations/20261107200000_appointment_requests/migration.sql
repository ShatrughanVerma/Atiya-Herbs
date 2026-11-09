-- AlterTable
ALTER TABLE `users` ADD COLUMN `credits` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `appointments` ADD COLUMN `city` VARCHAR(80) NULL,
    ADD COLUMN `concern` VARCHAR(200) NULL,
    ADD COLUMN `creditsUsed` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `duration` VARCHAR(30) NULL,
    ADD COLUMN `forSelf` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `preferredDate` VARCHAR(10) NULL,
    MODIFY `startsAt` DATETIME(3) NULL,
    MODIFY `endsAt` DATETIME(3) NULL,
    MODIFY `status` ENUM('requested', 'booked', 'cancelled', 'completed') NOT NULL DEFAULT 'booked';

-- CreateTable
CREATE TABLE `credit_ledger` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` CHAR(36) NOT NULL,
    `delta` INTEGER NOT NULL,
    `reason` VARCHAR(60) NOT NULL,
    `appointmentId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `credit_ledger_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `credit_ledger` ADD CONSTRAINT `credit_ledger_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

