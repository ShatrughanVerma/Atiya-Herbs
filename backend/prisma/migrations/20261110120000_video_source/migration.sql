-- Where a video came from: the network address and the phone / app of the upload
ALTER TABLE `consult_videos` ADD COLUMN `uploadIp` VARCHAR(64) NULL,
    ADD COLUMN `uploadDevice` VARCHAR(250) NULL;
