const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');

// MySQL store. Same interface as memoryStore.js. Dates are kept in UTC (timezone 'Z').
// Tables are in sql/schema.sql and are created on start when they are missing.

const REC_COLUMNS = {
  status: 'Status',
  expectedChunks: 'ExpectedChunks',
  finishRequested: 'FinishRequested',
  finalPath: 'FinalPath',
  sizeBytes: 'SizeBytes',
  durationSec: 'DurationSec',
  missingChunks: 'MissingChunks',
  corruptChunks: 'CorruptChunks',
  attempts: 'Attempts',
  nextAttemptAt: 'NextAttemptAt',
  error: 'Error',
  lastChunkAt: 'LastChunkAt',
  completedAt: 'CompletedAt',
};

const CHUNK_COLUMNS = {
  status: 'Status',
  transferError: 'TransferError',
  filePath: 'FilePath',
  sizeBytes: 'SizeBytes',
};

const toRecording = row =>
  row && {
    callId: row.CallId,
    status: row.Status,
    expectedChunks: row.ExpectedChunks,
    finishRequested: !!row.FinishRequested,
    finalPath: row.FinalPath,
    sizeBytes: row.SizeBytes == null ? null : Number(row.SizeBytes),
    durationSec: row.DurationSec,
    missingChunks: row.MissingChunks,
    corruptChunks: row.CorruptChunks,
    attempts: row.Attempts,
    nextAttemptAt: row.NextAttemptAt,
    error: row.Error,
    createdAt: row.CreatedAt,
    lastChunkAt: row.LastChunkAt,
    completedAt: row.CompletedAt,
  };

const toChunk = row => ({
  callId: row.CallId,
  track: row.Track,
  seq: row.Seq,
  filePath: row.FilePath,
  sizeBytes: Number(row.SizeBytes),
  sha256: row.Sha256,
  status: row.Status,
  transferError: row.TransferError,
  receivedAt: row.ReceivedAt,
});

const safeName = name => /^[A-Za-z0-9_]{1,64}$/.test(name);

function createMysqlStore(config, {logger} = {}) {
  let pool = null;
  const connection = {host: config.host, port: config.port, user: config.user, password: config.password, timezone: 'Z', bigNumberStrings: false, supportBigNumbers: true};

  async function updateRow(table, columns, whereSql, whereArgs, patch) {
    const sets = [];
    const args = [];
    for (const [field, value] of Object.entries(patch)) {
      if (columns[field]) {
        sets.push(`${columns[field]} = ?`);
        args.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
      }
    }
    if (sets.length) {
      await pool.query(`UPDATE ${table} SET ${sets.join(', ')} WHERE ${whereSql}`, [...args, ...whereArgs]);
    }
  }

  return {
    async init() {
      if (!safeName(config.database)) {
        throw new Error('MYSQL_DATABASE may only contain letters, digits and _');
      }
      // Make the database if the user is allowed to; if not, it must already exist
      try {
        const first = await mysql.createConnection(connection);
        await first.query(`CREATE DATABASE IF NOT EXISTS \`${config.database}\` CHARACTER SET utf8mb4`);
        await first.end();
      } catch (error) {
        logger && logger.warn('could not create the database (it must already exist)', {error: error.message});
      }
      pool = mysql.createPool({...connection, database: config.database, waitForConnections: true, connectionLimit: 10});
      pool.on('error', error => logger && logger.error('mysql pool error', {error: error.message}));
      const schema = fs.readFileSync(path.join(__dirname, '..', '..', 'sql', 'schema.sql'), 'utf8').replace(/^--.*$/gm, '');
      for (const statement of schema.split(';').map(s => s.trim()).filter(Boolean)) {
        await pool.query(statement);
      }
    },

    async ensureRecording(callId, now) {
      await pool.query("INSERT IGNORE INTO CallRecordings (CallId, Status, CreatedAt) VALUES (?, 'receiving', ?)", [callId, now]);
      return this.getRecording(callId);
    },

    async getRecording(callId) {
      const [rows] = await pool.query('SELECT * FROM CallRecordings WHERE CallId = ?', [callId]);
      return toRecording(rows[0]) || null;
    },

    async updateRecording(callId, patch) {
      await updateRow('CallRecordings', REC_COLUMNS, 'CallId = ?', [callId], patch);
    },

    async insertChunk(chunk) {
      try {
        await pool.query(
          'INSERT INTO CallChunks (CallId, Track, Seq, FilePath, SizeBytes, Sha256, Status, ReceivedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [chunk.callId, chunk.track, chunk.seq, chunk.filePath, chunk.sizeBytes, chunk.sha256, chunk.status, chunk.receivedAt],
        );
        return {created: true, chunk};
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
          const [rows] = await pool.query('SELECT * FROM CallChunks WHERE CallId = ? AND Track = ? AND Seq = ?', [chunk.callId, chunk.track, chunk.seq]);
          return {created: false, chunk: toChunk(rows[0])};
        }
        throw error;
      }
    },

    async updateChunk(callId, track, seq, patch) {
      await updateRow('CallChunks', CHUNK_COLUMNS, 'CallId = ? AND Track = ? AND Seq = ?', [callId, track, seq], patch);
    },

    async listChunks(callId) {
      const [rows] = await pool.query('SELECT * FROM CallChunks WHERE CallId = ? ORDER BY Seq, Track', [callId]);
      return rows.map(toChunk);
    },

    async requestFinish(callId, expectedChunks, now) {
      await this.ensureRecording(callId, now);
      // the SET parts run left to right in MySQL, so NextAttemptAt and Status are decided before Status changes
      await pool.query(
        `UPDATE CallRecordings
         SET FinishRequested = 1,
             ExpectedChunks = COALESCE(?, ExpectedChunks),
             NextAttemptAt = IF(Status = 'receiving', ?, NextAttemptAt),
             Status = IF(Status = 'receiving', 'pending', Status)
         WHERE CallId = ?`,
        [expectedChunks == null ? null : expectedChunks, now, callId],
      );
      return this.getRecording(callId);
    },

    async closeIdle(cutoff, now) {
      const [rows] = await pool.query("SELECT CallId FROM CallRecordings WHERE Status = 'receiving' AND LastChunkAt IS NOT NULL AND LastChunkAt < ?", [cutoff]);
      const closed = [];
      for (const {CallId} of rows) {
        const [result] = await pool.query("UPDATE CallRecordings SET Status = 'pending', NextAttemptAt = ? WHERE CallId = ? AND Status = 'receiving'", [now, CallId]);
        if (result.affectedRows) {
          closed.push(CallId);
        }
      }
      return closed;
    },

    // Several workers can call this at once: FOR UPDATE SKIP LOCKED makes each take a different row
    async claimNext(now) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [rows] = await conn.query(
          "SELECT CallId FROM CallRecordings WHERE Status = 'pending' AND (NextAttemptAt IS NULL OR NextAttemptAt <= ?) ORDER BY CreatedAt LIMIT 1 FOR UPDATE SKIP LOCKED",
          [now],
        );
        if (!rows.length) {
          await conn.commit();
          return null;
        }
        await conn.query("UPDATE CallRecordings SET Status = 'processing', Attempts = Attempts + 1 WHERE CallId = ?", [rows[0].CallId]);
        const [fresh] = await conn.query('SELECT * FROM CallRecordings WHERE CallId = ?', [rows[0].CallId]);
        await conn.commit();
        return toRecording(fresh[0]);
      } catch (error) {
        await conn.rollback();
        throw error;
      } finally {
        conn.release();
      }
    },

    async requeueStuck() {
      const [result] = await pool.query("UPDATE CallRecordings SET Status = 'pending' WHERE Status = 'processing'");
      return result.affectedRows || 0;
    },

    async listChunkCleanup(cutoff, limit = 50) {
      const [rows] = await pool.query(
        `SELECT r.CallId FROM CallRecordings r
         WHERE r.Status = 'completed' AND r.CompletedAt < ?
           AND EXISTS (SELECT 1 FROM CallChunks c WHERE c.CallId = r.CallId AND c.Status <> 'deleted')
         ORDER BY r.CompletedAt LIMIT ?`,
        [cutoff, limit],
      );
      return rows.map(row => row.CallId);
    },

    async markChunksDeleted(callId) {
      await pool.query("UPDATE CallChunks SET Status = 'deleted' WHERE CallId = ?", [callId]);
    },

    async close() {
      if (pool) {
        await pool.end();
      }
    },
  };
}

module.exports = {createMysqlStore};
