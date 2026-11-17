-- MySQL 8. The server runs this on start (every statement is "IF NOT EXISTS"), so you do not have to.
-- Times are stored in UTC.

CREATE TABLE IF NOT EXISTS CallChunks (
  Id            BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  CallId        VARCHAR(100) NOT NULL,
  Track         VARCHAR(20)  NOT NULL,           -- av, audio or video
  Seq           INT          NOT NULL,
  FilePath      VARCHAR(500) NOT NULL,
  SizeBytes     BIGINT       NOT NULL,
  Sha256        CHAR(64)     NOT NULL,
  Status        VARCHAR(20)  NOT NULL,           -- received, corrupt, deleted
  TransferError VARCHAR(500) NULL,
  ReceivedAt    DATETIME(3)  NOT NULL,
  UNIQUE KEY UQ_CallChunks (CallId, Track, Seq)
);

CREATE TABLE IF NOT EXISTS CallRecordings (
  CallId          VARCHAR(100) NOT NULL PRIMARY KEY,
  Status          VARCHAR(20)  NOT NULL,         -- receiving, pending, processing, completed, partial, failed
  ExpectedChunks  INT          NULL,
  FinishRequested TINYINT(1)   NOT NULL DEFAULT 0,
  FinalPath       VARCHAR(500) NULL,
  SizeBytes       BIGINT       NULL,
  DurationSec     INT          NULL,
  MissingChunks   VARCHAR(500) NULL,             -- e.g. "av:4,av:9"
  CorruptChunks   INT          NOT NULL DEFAULT 0,
  Attempts        INT          NOT NULL DEFAULT 0,
  NextAttemptAt   DATETIME(3)  NULL,
  Error           VARCHAR(1000) NULL,
  CreatedAt       DATETIME(3)  NOT NULL,
  LastChunkAt     DATETIME(3)  NULL,
  CompletedAt     DATETIME(3)  NULL,
  KEY IX_CallRecordings_Queue (Status, NextAttemptAt)
);
