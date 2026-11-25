-- Banner pictures uploaded in the admin panel, kept in the database so they survive deploys of the server.
CREATE TABLE `banner_images` (
  `name` VARCHAR(48) NOT NULL,
  `data` MEDIUMBLOB NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
