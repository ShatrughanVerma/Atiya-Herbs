-- Health wellness: the reminder settings (times are minutes after midnight; the phone sets the alarms from them)
ALTER TABLE `wellness_settings`
    ADD COLUMN `waterReminderOn` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `waterEveryMin` INTEGER NOT NULL DEFAULT 120,
    ADD COLUMN `waterFromMin` INTEGER NOT NULL DEFAULT 540,
    ADD COLUMN `waterUntilMin` INTEGER NOT NULL DEFAULT 1260,
    ADD COLUMN `medMorningMin` INTEGER NOT NULL DEFAULT 480,
    ADD COLUMN `medAfternoonMin` INTEGER NOT NULL DEFAULT 780,
    ADD COLUMN `medEveningMin` INTEGER NOT NULL DEFAULT 1080,
    ADD COLUMN `medNightMin` INTEGER NOT NULL DEFAULT 1260,
    ADD COLUMN `checkinOn` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `checkinAtMin` INTEGER NOT NULL DEFAULT 1200;
