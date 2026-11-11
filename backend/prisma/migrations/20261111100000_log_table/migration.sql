-- The access log of the videos: who played or downloaded which video, for which patient, and when (India time)
CREATE TABLE `log` (
    `serialNo` INTEGER NOT NULL AUTO_INCREMENT,
    `whoPlayed` VARCHAR(100) NULL,
    `whoDownloaded` VARCHAR(100) NULL,
    `uidName` VARCHAR(150) NULL,
    `videoFile` VARCHAR(80) NULL,
    `patientPhone` VARCHAR(15) NULL,
    `patientId` VARCHAR(10) NULL,
    `dateTime` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(64) NULL,
    `createdOn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `log_patientId_idx`(`patientId`),
    INDEX `log_patientPhone_idx`(`patientPhone`),
    PRIMARY KEY (`serialNo`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
