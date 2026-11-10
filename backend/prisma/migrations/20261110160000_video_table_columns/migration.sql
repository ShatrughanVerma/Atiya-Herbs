-- consult_videos: the column names asked for (videoId, videoFileName, videoFilePath, patientPhone, createdOn)
-- and the new ones (sessionId, consultationDateTime, createdBy).
ALTER TABLE `consult_videos`
    RENAME COLUMN `videoCode` TO `videoId`,
    RENAME COLUMN `fileName` TO `videoFileName`,
    RENAME COLUMN `location` TO `videoFilePath`,
    RENAME COLUMN `patientMobile` TO `patientPhone`,
    RENAME COLUMN `createdAt` TO `createdOn`,
    ADD COLUMN `sessionId` VARCHAR(10) NULL,
    ADD COLUMN `consultationDateTime` DATETIME(3) NULL,
    ADD COLUMN `createdBy` VARCHAR(64) NULL;

UPDATE `consult_videos`
   SET `sessionId` = CONCAT('S', LPAD(`video_no`, 6, '0')),
       `consultationDateTime` = `createdOn`,
       `createdBy` = `doctorId`;

-- indexes carry the column name in their own name
DROP INDEX `consult_videos_patientMobile_idx` ON `consult_videos`;
DROP INDEX `consult_videos_doctorId_createdAt_idx` ON `consult_videos`;
CREATE INDEX `consult_videos_patientPhone_idx` ON `consult_videos`(`patientPhone`);
CREATE INDEX `consult_videos_doctorId_createdOn_idx` ON `consult_videos`(`doctorId`, `createdOn`);
