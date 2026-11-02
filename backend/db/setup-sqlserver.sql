/*
  One-time database setup for the Atiya Herbs API (SQL Server).

  Run it as an administrator (for example in SQL Server Management Studio, connected as "sa" or Windows login).
  BEFORE running, replace both passwords below with long random ones, and use the same values in backend\.env
  (DB_PASSWORD and MIGRATE_DB_PASSWORD). Do not keep these placeholders.

  Two logins, on purpose (least privilege):
    atiya_migrator  may create and change tables. Used only when you run  npm run db:migrate:*
    atiya_app       may only read and write data. The running API uses this one, so a hacked API
                    cannot drop tables or change the schema.
*/

IF DB_ID(N'atiyaherbs') IS NULL
    CREATE DATABASE atiyaherbs;
GO

USE atiyaherbs;
GO

-- Logins live on the server; users live inside the database
IF SUSER_ID(N'atiya_migrator') IS NULL
    CREATE LOGIN atiya_migrator WITH PASSWORD = N'CHANGE-ME-migrator-password-1!', CHECK_POLICY = ON;
IF SUSER_ID(N'atiya_app') IS NULL
    CREATE LOGIN atiya_app WITH PASSWORD = N'CHANGE-ME-app-password-2!', CHECK_POLICY = ON;
GO

IF USER_ID(N'atiya_migrator') IS NULL CREATE USER atiya_migrator FOR LOGIN atiya_migrator;
IF USER_ID(N'atiya_app') IS NULL CREATE USER atiya_app FOR LOGIN atiya_app;
GO

-- The migration login owns the schema changes
ALTER ROLE db_owner ADD MEMBER atiya_migrator;

-- The API login: data only (SELECT, INSERT, UPDATE, DELETE). No db_owner, no db_ddladmin.
ALTER ROLE db_datareader ADD MEMBER atiya_app;
ALTER ROLE db_datawriter ADD MEMBER atiya_app;
GO

-- Prisma "migrate dev" (development only) also needs to create a temporary shadow database:
--   ALTER SERVER ROLE dbcreator ADD MEMBER atiya_migrator;
-- Do NOT give that permission on a production server; production uses "migrate deploy", which needs no shadow database.
