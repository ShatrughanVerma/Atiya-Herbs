-- Who removed a video: the archive policy or the doctor (the video file is gone either way, the row stays as a record)
ALTER TABLE `consult_videos` ADD COLUMN `removedBy` VARCHAR(10) NULL;
UPDATE `consult_videos` SET `removedBy` = 'policy' WHERE `deletedAt` IS NOT NULL;
