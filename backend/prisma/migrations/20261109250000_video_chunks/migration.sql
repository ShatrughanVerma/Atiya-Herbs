-- CreateTable
CREATE TABLE `video_chunks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `fileKey` VARCHAR(80) NOT NULL,
    `seq` INTEGER NOT NULL,
    `size` INTEGER NOT NULL,
    `data` LONGBLOB NOT NULL,

    UNIQUE INDEX `video_chunks_fileKey_seq_key`(`fileKey`, `seq`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

