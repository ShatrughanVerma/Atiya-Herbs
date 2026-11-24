-- Health wellness (Atiya 360): a person's goals, and one row per day with the water drunk and the mood
CREATE TABLE `wellness_settings` (
    `userId` CHAR(36) NOT NULL,
    `waterGoalGlasses` INTEGER NOT NULL DEFAULT 8,
    `glassMl` INTEGER NOT NULL DEFAULT 250,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wellness_days` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` CHAR(36) NOT NULL,
    `day` CHAR(10) NOT NULL,
    `waterMl` INTEGER NOT NULL DEFAULT 0,
    `mood` VARCHAR(10) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `wellness_days_userId_idx`(`userId`),
    UNIQUE INDEX `wellness_days_userId_day_key`(`userId`, `day`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `wellness_settings` ADD CONSTRAINT `wellness_settings_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wellness_days` ADD CONSTRAINT `wellness_days_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
