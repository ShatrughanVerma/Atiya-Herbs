-- CreateTable
CREATE TABLE `clinics` (
    `id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `area` VARCHAR(100) NOT NULL,
    `city` VARCHAR(80) NOT NULL,
    `state` VARCHAR(80) NOT NULL,
    `pincode` VARCHAR(6) NULL,
    `address` VARCHAR(300) NULL,
    `phone` VARCHAR(20) NULL,
    `timings` VARCHAR(120) NULL,
    `lat` DOUBLE NOT NULL,
    `lng` DOUBLE NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `clinics_city_idx`(`city`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `doctors` (
    `id` VARCHAR(64) NOT NULL,
    `userId` CHAR(36) NULL,
    `clinicId` VARCHAR(64) NULL,
    `name` VARCHAR(120) NOT NULL,
    `photoUrl` VARCHAR(500) NULL,
    `specialization` VARCHAR(100) NOT NULL,
    `qualifications` VARCHAR(200) NULL,
    `experienceYears` INTEGER NOT NULL DEFAULT 0,
    `languages` VARCHAR(120) NULL,
    `bio` TEXT NULL,
    `fee` INTEGER NOT NULL,
    `rating` DOUBLE NOT NULL DEFAULT 0,
    `reviewCount` INTEGER NOT NULL DEFAULT 0,
    `modes` JSON NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `doctors_userId_key`(`userId`),
    INDEX `doctors_specialization_idx`(`specialization`),
    INDEX `doctors_clinicId_idx`(`clinicId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `doctor_schedules` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `doctorId` VARCHAR(64) NOT NULL,
    `weekday` INTEGER NOT NULL,
    `startTime` VARCHAR(5) NOT NULL,
    `endTime` VARCHAR(5) NOT NULL,
    `slotMinutes` INTEGER NOT NULL DEFAULT 20,

    INDEX `doctor_schedules_doctorId_weekday_idx`(`doctorId`, `weekday`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `appointments` (
    `id` CHAR(36) NOT NULL,
    `number` VARCHAR(24) NOT NULL,
    `userId` CHAR(36) NULL,
    `doctorId` VARCHAR(64) NOT NULL,
    `clinicId` VARCHAR(64) NULL,
    `type` ENUM('text', 'audio', 'video', 'clinic') NOT NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NOT NULL,
    `status` ENUM('booked', 'cancelled', 'completed') NOT NULL DEFAULT 'booked',
    `slotKey` VARCHAR(100) NULL,
    `patientName` VARCHAR(100) NOT NULL,
    `patientMobile` VARCHAR(15) NOT NULL,
    `reason` VARCHAR(500) NULL,
    `fee` INTEGER NOT NULL,
    `paymentStatus` VARCHAR(20) NOT NULL DEFAULT 'pay_later',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `appointments_number_key`(`number`),
    UNIQUE INDEX `appointments_slotKey_key`(`slotKey`),
    INDEX `appointments_userId_startsAt_idx`(`userId`, `startsAt`),
    INDEX `appointments_doctorId_startsAt_idx`(`doctorId`, `startsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `doctors` ADD CONSTRAINT `doctors_clinicId_fkey` FOREIGN KEY (`clinicId`) REFERENCES `clinics`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `doctor_schedules` ADD CONSTRAINT `doctor_schedules_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `doctors`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `doctors`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

