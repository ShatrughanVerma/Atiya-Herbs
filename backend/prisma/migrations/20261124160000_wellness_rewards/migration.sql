-- Health wellness rewards: every point earned (+) or turned into wallet money (-). `refKey` is unique, so the same good
-- thing is never paid twice.
CREATE TABLE `wellness_points` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` CHAR(36) NOT NULL,
    `points` INTEGER NOT NULL,
    `reason` VARCHAR(20) NOT NULL,
    `ref` VARCHAR(40) NULL,
    `day` CHAR(10) NULL,
    `refKey` VARCHAR(120) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `wellness_points_refKey_key`(`refKey`),
    INDEX `wellness_points_userId_reason_idx`(`userId`, `reason`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `wellness_points` ADD CONSTRAINT `wellness_points_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
