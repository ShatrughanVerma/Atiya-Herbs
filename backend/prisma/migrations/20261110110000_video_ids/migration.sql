-- The video table says whose video it is by ids that people can read: the video id (V000012), the patient id (P000123)
-- and the doctor id (doctorId). A video no longer belongs to a visit, so the visit columns are removed.
ALTER TABLE `consult_videos` ADD COLUMN `videoCode` VARCHAR(10) NULL,
    ADD COLUMN `patientCode` VARCHAR(10) NULL;

-- the videos that are already there
UPDATE `consult_videos` SET `videoCode` = CONCAT('V', LPAD(`video_no`, 6, '0'));
UPDATE `consult_videos` v JOIN `users` u ON u.`id` = v.`userId` SET v.`patientCode` = CONCAT('P', LPAD(u.`patient_no`, 6, '0'));

DROP INDEX `consult_videos_appointmentId_idx` ON `consult_videos`;
ALTER TABLE `consult_videos` DROP COLUMN `appointmentId`,
    DROP COLUMN `appointmentNumber`;
CREATE INDEX `consult_videos_patientCode_idx` ON `consult_videos`(`patientCode`);
