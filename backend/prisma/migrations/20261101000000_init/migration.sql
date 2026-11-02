BEGIN TRY

BEGIN TRAN;

-- CreateSchema
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = N'dbo') EXEC sp_executesql N'CREATE SCHEMA [dbo];';

-- CreateTable
CREATE TABLE [dbo].[users] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [mobile] VARCHAR(15) NOT NULL,
    [name] NVARCHAR(100),
    [email] NVARCHAR(254),
    [role] VARCHAR(20) NOT NULL CONSTRAINT [users_role_df] DEFAULT 'customer',
    [status] VARCHAR(20) NOT NULL CONSTRAINT [users_status_df] DEFAULT 'active',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [users_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    [lastLoginAt] DATETIME2,
    CONSTRAINT [users_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [users_mobile_key] UNIQUE NONCLUSTERED ([mobile])
);

-- CreateTable
CREATE TABLE [dbo].[otp_challenges] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [mobile] VARCHAR(15) NOT NULL,
    [codeHash] CHAR(64) NOT NULL,
    [attempts] INT NOT NULL CONSTRAINT [otp_challenges_attempts_df] DEFAULT 0,
    [expiresAt] DATETIME2 NOT NULL,
    [consumedAt] DATETIME2,
    [requestIp] VARCHAR(64),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [otp_challenges_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [otp_challenges_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[refresh_tokens] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [userId] UNIQUEIDENTIFIER NOT NULL,
    [tokenHash] CHAR(64) NOT NULL,
    [familyId] UNIQUEIDENTIFIER NOT NULL,
    [expiresAt] DATETIME2 NOT NULL,
    [revokedAt] DATETIME2,
    [userAgent] NVARCHAR(255),
    [ip] VARCHAR(64),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [refresh_tokens_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [refresh_tokens_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [refresh_tokens_tokenHash_key] UNIQUE NONCLUSTERED ([tokenHash])
);

-- CreateTable
CREATE TABLE [dbo].[audit_logs] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [userId] UNIQUEIDENTIFIER,
    [action] VARCHAR(64) NOT NULL,
    [ip] VARCHAR(64),
    [userAgent] NVARCHAR(255),
    [metadata] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [audit_logs_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [audit_logs_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [otp_challenges_mobile_createdAt_idx] ON [dbo].[otp_challenges]([mobile], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [refresh_tokens_userId_idx] ON [dbo].[refresh_tokens]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [refresh_tokens_familyId_idx] ON [dbo].[refresh_tokens]([familyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [audit_logs_userId_createdAt_idx] ON [dbo].[audit_logs]([userId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [audit_logs_action_createdAt_idx] ON [dbo].[audit_logs]([action], [createdAt]);

-- AddForeignKey
ALTER TABLE [dbo].[refresh_tokens] ADD CONSTRAINT [refresh_tokens_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[audit_logs] ADD CONSTRAINT [audit_logs_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

