-- A video belongs to a patient and a doctor, not to a visit: the visit columns may be empty
ALTER TABLE `consult_videos` MODIFY `appointmentId` CHAR(36) NULL,
    MODIFY `appointmentNumber` VARCHAR(24) NULL;
