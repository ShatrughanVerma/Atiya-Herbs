-- The folder a video is saved in (the full file path stays in videoFilePath)
ALTER TABLE `consult_videos` ADD COLUMN `destinationPath` VARCHAR(300) NULL;
UPDATE `consult_videos` SET `destinationPath` = SUBSTRING(`videoFilePath`, 1, CHAR_LENGTH(`videoFilePath`) - CHAR_LENGTH(`videoFileName`) - 1) WHERE `videoFilePath` IS NOT NULL AND `videoFileName` IS NOT NULL;
