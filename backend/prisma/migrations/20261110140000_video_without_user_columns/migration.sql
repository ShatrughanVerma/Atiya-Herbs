-- A video is tied to a patient by the patient id (patientCode, P000123) and to a doctor by the doctor id (doctorId).
-- The long account ids are not needed: userId is replaced by patientCode, consentByUserId by doctorId.
ALTER TABLE `consult_videos` DROP COLUMN `userId`,
    DROP COLUMN `consentByUserId`;
