-- Health wellness: steps of the day, the step goal, and the walks recorded in Walk mode
ALTER TABLE `wellness_settings` ADD COLUMN `stepGoal` INTEGER NOT NULL DEFAULT 6000;

-- AlterTable
ALTER TABLE `wellness_days` ADD COLUMN `steps` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `wellness_walks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` CHAR(36) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL,
    `durationSec` INTEGER NOT NULL,
    `steps` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `wellness_walks_userId_startedAt_idx`(`userId`, `startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `wellness_walks` ADD CONSTRAINT `wellness_walks_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
