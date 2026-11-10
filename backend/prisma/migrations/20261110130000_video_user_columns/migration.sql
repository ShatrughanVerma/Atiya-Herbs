-- Puts back the two columns of consult_videos that were missing in the database:
--   userId           the patient's account (the long id behind the patient id P000123)
--   consentByUserId  the doctor's login that confirmed the patient's agreement
-- The videos that are already there get them from the patient id and the doctor id written in the same row.
ALTER TABLE `consult_videos` ADD COLUMN `userId` CHAR(36) NULL,
    ADD COLUMN `consentByUserId` CHAR(36) NULL;

UPDATE `consult_videos` v JOIN `users` u ON u.`patient_no` = CAST(SUBSTRING(v.`patientCode`, 2) AS UNSIGNED)
SET v.`userId` = u.`id` WHERE v.`patientCode` IS NOT NULL;

UPDATE `consult_videos` v JOIN `doctors` d ON d.`id` = v.`doctorId`
SET v.`consentByUserId` = d.`userId` WHERE d.`userId` IS NOT NULL;
