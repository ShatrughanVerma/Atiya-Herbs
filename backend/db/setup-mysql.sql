-- One-time MySQL 8 setup for the Atiya Herbs API.
-- Run it once as an administrator (root) of your MySQL server, after replacing the two CHANGE-ME passwords:
--   mysql -u root -p < db/setup-mysql.sql
-- or paste it into MySQL Workbench and run it.
--
-- It creates:
--   * the database `atiyaherbs` (utf8mb4: Hindi, Urdu and emoji all work)
--   * `atiya_app`      the login the running API uses. It can only read and change DATA. It cannot create, alter or
--                      drop tables, so a bug or an attack through the API can never damage the structure.
--   * `atiya_migrator` the login used only by `npm run db:migrate:*`. It may create and change tables.
--
-- On a cloud MySQL (Aiven, TiDB Cloud, Railway, ...) you usually cannot run this as root: create the database and
-- the two users in the provider's panel with the same rights, or use its admin user once for the migration.
-- Use long random passwords (at least 20 characters) and never put them in this file once they are real.

CREATE DATABASE IF NOT EXISTS `atiyaherbs` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- '%' lets the user connect from another machine (Render, your PC). On a single machine use 'localhost' instead.
CREATE USER IF NOT EXISTS 'atiya_app'@'%' IDENTIFIED BY 'CHANGE-ME-app-password';
CREATE USER IF NOT EXISTS 'atiya_migrator'@'%' IDENTIFIED BY 'CHANGE-ME-migrator-password';

GRANT SELECT, INSERT, UPDATE, DELETE ON `atiyaherbs`.* TO 'atiya_app'@'%';

-- Prisma Migrate also needs a second, throw-away database ("shadow database") when you run `migrate dev` on your PC.
-- `migrate deploy` (used on servers) does not need it. This keeps the migrator able to create it.
GRANT ALL PRIVILEGES ON `atiyaherbs`.* TO 'atiya_migrator'@'%';
GRANT ALL PRIVILEGES ON `prisma\_migrate\_shadow\_db\_%`.* TO 'atiya_migrator'@'%';

FLUSH PRIVILEGES;
