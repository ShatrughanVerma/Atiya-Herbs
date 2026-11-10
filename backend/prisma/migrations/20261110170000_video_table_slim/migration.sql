-- consult_videos keeps only: videoId, sessionId, consultationDateTime, doctorId, patientName, patientPhone, videoFileName,
-- videoFilePath, status, createdOn, createdBy (and its two keys id / video_no).
-- What the dropped columns said is now carried by `status`: held = on legal hold, archived = removed by the policy,
-- deleted = removed by the doctor.
ALTER TABLE `consult_videos` MODIFY `status` ENUM('uploading', 'uploaded', 'failed', 'held', 'archived', 'deleted') NOT NULL DEFAULT 'uploading';

UPDATE `consult_videos` SET `status` = 'held' WHERE `legalHold` = 1 AND `deletedAt` IS NULL AND `status` = 'uploaded';
UPDATE `consult_videos` SET `status` = IF(`removedBy` = 'doctor', 'deleted', 'archived') WHERE `deletedAt` IS NOT NULL;
UPDATE `consult_videos` SET `videoFileName` = CONCAT(`id`, '.', CASE `mimeType` WHEN 'video/quicktime' THEN 'mov' WHEN 'video/3gpp' THEN '3gp' WHEN 'video/webm' THEN 'webm' WHEN 'video/x-matroska' THEN 'mkv' ELSE 'mp4' END) WHERE `videoFileName` IS NULL;

DROP INDEX `consult_videos_patientCode_idx` ON `consult_videos`;
ALTER TABLE `consult_videos`
    DROP COLUMN `doctorName`,
    DROP COLUMN `patientCode`,
    DROP COLUMN `storageKind`,
    DROP COLUMN `uploadIp`,
    DROP COLUMN `uploadDevice`,
    DROP COLUMN `url`,
    DROP COLUMN `mimeType`,
    DROP COLUMN `sizeBytes`,
    DROP COLUMN `durationSec`,
    DROP COLUMN `failedReason`,
    DROP COLUMN `consentAt`,
    DROP COLUMN `uploadedAt`,
    DROP COLUMN `legalHold`,
    DROP COLUMN `deletedAt`,
    DROP COLUMN `removedBy`;
