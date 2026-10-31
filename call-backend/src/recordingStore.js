// Where the details of each recording are kept (who, when, how long, which file, who agreed).
// The recording file itself goes to Cloudflare R2; only these details go here.
//  - D1Store: Cloudflare D1 (a free SQLite database) through Cloudflare's HTTP API
//  - MemoryStore: used when D1 isn't configured (lost when the server restarts; the R2 file and
//    LiveKit's manifest next to it still have the basics)

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS call_recordings (
    id TEXT PRIMARY KEY,
    call_id TEXT NOT NULL,
    room TEXT NOT NULL,
    caller TEXT NOT NULL,
    callee TEXT NOT NULL,
    requested_by TEXT NOT NULL,
    allowed_by TEXT NOT NULL,
    consent_at TEXT NOT NULL,
    mode TEXT NOT NULL,
    status TEXT NOT NULL,
    destination TEXT,
    bucket TEXT,
    object_key TEXT,
    cloudinary_public_id TEXT,
    cloudinary_resource_type TEXT,
    cloudinary_delivery_type TEXT,
    size_bytes INTEGER,
    duration_seconds INTEGER,
    started_at TEXT,
    ended_at TEXT,
    error TEXT,
    created_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_call_recordings_call ON call_recordings (call_id)',
  'CREATE INDEX IF NOT EXISTS idx_call_recordings_created ON call_recordings (created_at)',
];

// For a table created before these columns existed: add them (an "already exists" error is fine)
const MIGRATIONS = [
  'ALTER TABLE call_recordings ADD COLUMN destination TEXT',
  'ALTER TABLE call_recordings ADD COLUMN cloudinary_public_id TEXT',
  'ALTER TABLE call_recordings ADD COLUMN cloudinary_resource_type TEXT',
  'ALTER TABLE call_recordings ADD COLUMN cloudinary_delivery_type TEXT',
];

const COLUMNS = [
  'id',
  'call_id',
  'room',
  'caller',
  'callee',
  'requested_by',
  'allowed_by',
  'consent_at',
  'mode',
  'status',
  'destination',
  'bucket',
  'object_key',
  'cloudinary_public_id',
  'cloudinary_resource_type',
  'cloudinary_delivery_type',
  'size_bytes',
  'duration_seconds',
  'started_at',
  'ended_at',
  'error',
  'created_at',
];

// A month key like "2026-10" in UTC; recordings are counted per calendar month
const monthKey = (date = new Date()) => date.toISOString().slice(0, 7);

class MemoryStore {
  constructor() {
    this.kind = 'memory';
    this.rows = new Map();
  }

  async init() {}

  async insert(row) {
    this.rows.set(row.id, {...row});
  }

  async update(id, fields) {
    const row = this.rows.get(id);
    if (row) {
      Object.assign(row, fields);
    }
  }

  async get(id) {
    return this.rows.get(id) || null;
  }

  async secondsRecordedInMonth(month = monthKey()) {
    let total = 0;
    for (const row of this.rows.values()) {
      if (row.created_at.startsWith(month)) {
        total += row.duration_seconds || 0;
      }
    }
    return total;
  }
}

class D1Store {
  constructor({accountId, databaseId, apiToken, fetchImpl = fetch}) {
    this.kind = 'd1';
    this.url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
    this.apiToken = apiToken;
    this.fetch = fetchImpl;
  }

  // Runs one SQL statement. Values always go in `params`, never inside the SQL text.
  async query(sql, params = []) {
    const res = await this.fetch(this.url, {
      method: 'POST',
      headers: {Authorization: `Bearer ${this.apiToken}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({sql, params}),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.success === false) {
      const detail = (body.errors || []).map(e => e.message).join('; ') || `HTTP ${res.status}`;
      throw new Error(`D1 query failed: ${detail}`);
    }
    return body.result?.[0]?.results || [];
  }

  async init() {
    for (const statement of SCHEMA) {
      await this.query(statement);
    }
    for (const statement of MIGRATIONS) {
      await this.query(statement).catch(e => {
        if (!/duplicate column/i.test(e.message)) {
          throw e;
        }
      });
    }
  }

  async insert(row) {
    const columns = COLUMNS.filter(c => row[c] !== undefined);
    await this.query(
      `INSERT INTO call_recordings (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      columns.map(c => row[c]),
    );
  }

  async update(id, fields) {
    const columns = Object.keys(fields).filter(c => COLUMNS.includes(c) && c !== 'id');
    if (!columns.length) {
      return;
    }
    await this.query(`UPDATE call_recordings SET ${columns.map(c => `${c} = ?`).join(', ')} WHERE id = ?`, [
      ...columns.map(c => fields[c]),
      id,
    ]);
  }

  async get(id) {
    const rows = await this.query('SELECT * FROM call_recordings WHERE id = ?', [id]);
    return rows[0] || null;
  }

  async secondsRecordedInMonth(month = monthKey()) {
    const rows = await this.query(
      'SELECT COALESCE(SUM(duration_seconds), 0) AS total FROM call_recordings WHERE created_at LIKE ?',
      [`${month}%`],
    );
    return Number(rows[0]?.total || 0);
  }
}

function createRecordingStore(env = process.env, log = () => {}) {
  if (env.CF_ACCOUNT_ID && env.D1_DATABASE_ID && env.CF_API_TOKEN) {
    return new D1Store({accountId: env.CF_ACCOUNT_ID, databaseId: env.D1_DATABASE_ID, apiToken: env.CF_API_TOKEN});
  }
  log('Cloudflare D1 is not configured: recording details are kept in memory only');
  return new MemoryStore();
}

module.exports = {createRecordingStore, D1Store, MemoryStore, monthKey, SCHEMA, MIGRATIONS};
