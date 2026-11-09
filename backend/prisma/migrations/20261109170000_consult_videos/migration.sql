-- CreateTable
CREATE TABLE `consult_videos` (
    `id` CHAR(36) NOT NULL,
    `appointmentId` CHAR(36) NOT NULL,
    `appointmentNumber` VARCHAR(24) NOT NULL,
    `doctorId` VARCHAR(64) NOT NULL,
    `doctorName` VARCHAR(120) NOT NULL,
    `userId` CHAR(36) NULL,
    `patientName` VARCHAR(100) NOT NULL,
    `patientMobile` VARCHAR(15) NOT NULL,
    `fileName` VARCHAR(80) NULL,
    `mimeType` VARCHAR(40) NOT NULL,
    `sizeBytes` INTEGER NULL,
    `durationSec` INTEGER NULL,
    `status` ENUM('uploading', 'uploaded', 'failed') NOT NULL DEFAULT 'uploading',
    `failedReason` VARCHAR(200) NULL,
    `consentAt` DATETIME(3) NULL,
    `consentByUserId` CHAR(36) NULL,
    `uploadedAt` DATETIME(3) NULL,
    `legalHold` BOOLEAN NOT NULL DEFAULT false,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `consult_videos_appointmentId_idx`(`appointmentId`),
    INDEX `consult_videos_patientMobile_idx`(`patientMobile`),
    INDEX `consult_videos_doctorId_createdAt_idx`(`doctorId`, `createdAt`),
    INDEX `consult_videos_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `video_audit` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `videoId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NULL,
    `action` VARCHAR(20) NOT NULL,
    `ip` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `video_audit_videoId_idx`(`videoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

