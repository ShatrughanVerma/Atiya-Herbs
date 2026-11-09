-- A short running number for every user (the existing users are numbered by MySQL)
ALTER TABLE `users` ADD COLUMN `patient_no` INTEGER NOT NULL AUTO_INCREMENT,
    ADD UNIQUE INDEX `users_patient_no_key`(`patient_no`);
