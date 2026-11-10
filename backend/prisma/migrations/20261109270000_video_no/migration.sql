-- A short running number for every video (the existing videos are numbered by MySQL).
-- The column and its unique key must be added in one statement: an AUTO_INCREMENT column has to be a key.
ALTER TABLE `consult_videos` ADD COLUMN `video_no` INTEGER NOT NULL AUTO_INCREMENT,
    ADD UNIQUE INDEX `consult_videos_video_no_key`(`video_no`);
