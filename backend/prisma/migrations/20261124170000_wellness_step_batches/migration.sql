-- Health wellness: the step batches the phone sends (one row per batch, each batch only once)
CREATE TABLE `wellness_step_batches` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` CHAR(36) NOT NULL,
    `batchId` VARCHAR(40) NOT NULL,
    `key` VARCHAR(100) NOT NULL,
    `steps` INTEGER NOT NULL,
    `recordedAt` DATETIME(3) NOT NULL,
    `day` CHAR(10) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `wellness_step_batches_key_key`(`key`),
    INDEX `wellness_step_batches_userId_day_idx`(`userId`, `day`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `wellness_step_batches` ADD CONSTRAINT `wellness_step_batches_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
