-- Password login: a password hash per user, a lock after repeated wrong passwords, and one account per email.
-- AlterTable
ALTER TABLE `users` ADD COLUMN `failedLoginCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `lockedUntil` DATETIME(3) NULL,
    ADD COLUMN `passwordHash` VARCHAR(255) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `users_email_key` ON `users`(`email`);
