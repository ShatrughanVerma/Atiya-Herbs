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
    original_size_bytes INTEGER,
    compressed INTEGER,
    duration_seconds INTEGER,
    started_at TEXT,
    ended_at TEXT,
    error TEXT,
    created_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_call_recordings_call ON call_recordings (call_id)',
  'CREATE INDEX IF NOT EXISTS idx_call_recordings_created ON call_recordings (created_at)',
  // Group meetings (see meetings.js): one row per meeting, one row each time someone joins it
  `CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY,
    title TEXT,
    host_id TEXT NOT NULL,
    host_name TEXT,
    max_participants INTEGER,
    status TEXT NOT NULL,
    locked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    ended_at TEXT,
    ended_by TEXT,
    peak_participants INTEGER NOT NULL DEFAULT 0
  )`,
  'CREATE INDEX IF NOT EXISTS idx_meetings_host ON meetings (host_id, created_at)',
  `CREATE TABLE IF NOT EXISTS meeting_participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT,
    role TEXT NOT NULL,
    joined_at TEXT NOT NULL,
    left_at TEXT,
    removed INTEGER NOT NULL DEFAULT 0
  )`,
  'CREATE INDEX IF NOT EXISTS idx_meeting_participants_meeting ON meeting_participants (meeting_id)',
  'CREATE INDEX IF NOT EXISTS idx_meeting_participants_user ON meeting_participants (user_id, joined_at)',
];

// For a table created before these columns existed: add them (an "already exists" error is fine)
const MIGRATIONS = [
  'ALTER TABLE call_recordings ADD COLUMN destination TEXT',
  'ALTER TABLE call_recordings ADD COLUMN cloudinary_public_id TEXT',
  'ALTER TABLE call_recordings ADD COLUMN cloudinary_resource_type TEXT',
  'ALTER TABLE call_recordings ADD COLUMN cloudinary_delivery_type TEXT',
  'ALTER TABLE call_recordings ADD COLUMN original_size_bytes INTEGER',
  'ALTER TABLE call_recordings ADD COLUMN compressed INTEGER',
];

const MEETING_COLUMNS = ['title', 'host_id', 'host_name', 'max_participants', 'status', 'locked', 'ended_at', 'ended_by', 'peak_participants'];

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
  'original_size_bytes',
  'compressed',
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

  // Finished recordings that are still only in R2 and are worth another try (not the ones Cloudinary can never take)
  async listPendingArchive(limit = 20) {
    return [...this.rows.values()]
      .filter(row => row.status === 'complete' && row.destination === 'r2' && !row.cloudinary_public_id && !/too-large|no-segments/.test(row.error || ''))
      .slice(0, limit)
      .map(row => row.id);
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

  // ---- group meetings ----
  async meetingCreate(meeting) {
    this.meetingRows = this.meetingRows || new Map();
    this.meetingRows.set(meeting.id, {locked: 0, peak_participants: 0, ...meeting});
  }

  async meetingUpdate(id, fields) {
    const row = this.meetingRows?.get(id);
    if (row) {
      Object.assign(row, Object.fromEntries(Object.entries(fields).filter(([k]) => MEETING_COLUMNS.includes(k))));
    }
  }

  async meetingGet(id) {
    return this.meetingRows?.get(id) || null;
  }

  async participantJoined(row) {
    this.participantRows = this.participantRows || [];
    this.participantRows.push({removed: 0, left_at: null, ...row});
  }

  // Marks the person's open visit as finished (removed = 1 when the host took them out)
  async participantLeft(meetingId, userId, leftAt, removed = false) {
    const open = (this.participantRows || []).filter(r => r.meeting_id === meetingId && r.user_id === userId && !r.left_at);
    for (const row of open) {
      row.left_at = leftAt;
      row.removed = removed ? 1 : 0;
    }
  }

  async participantsOf(meetingId) {
    return (this.participantRows || []).filter(r => r.meeting_id === meetingId);
  }

  // The meetings this person hosted or joined, newest first
  async meetingsFor(userId, limit = 20) {
    const ids = new Set((this.participantRows || []).filter(r => r.user_id === userId).map(r => r.meeting_id));
    return [...(this.meetingRows?.values() || [])]
      .filter(m => m.host_id === userId || ids.has(m.id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
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

  async listPendingArchive(limit = 20) {
    const rows = await this.query(
      "SELECT id FROM call_recordings WHERE status = 'complete' AND destination = 'r2' AND cloudinary_public_id IS NULL AND (error IS NULL OR (error NOT LIKE '%too-large%' AND error NOT LIKE '%no-segments%')) ORDER BY created_at LIMIT ?",
      [limit],
    );
    return rows.map(row => row.id);
  }

  async secondsRecordedInMonth(month = monthKey()) {
    const rows = await this.query(
      'SELECT COALESCE(SUM(duration_seconds), 0) AS total FROM call_recordings WHERE created_at LIKE ?',
      [`${month}%`],
    );
    return Number(rows[0]?.total || 0);
  }

  // ---- group meetings ----
  async meetingCreate(meeting) {
    const columns = ['id', 'created_at', ...MEETING_COLUMNS].filter(c => meeting[c] !== undefined);
    await this.query(
      `INSERT INTO meetings (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      columns.map(c => meeting[c]),
    );
  }

  async meetingUpdate(id, fields) {
    const columns = Object.keys(fields).filter(c => MEETING_COLUMNS.includes(c));
    if (!columns.length) {
      return;
    }
    await this.query(`UPDATE meetings SET ${columns.map(c => `${c} = ?`).join(', ')} WHERE id = ?`, [
      ...columns.map(c => fields[c]),
      id,
    ]);
  }

  async meetingGet(id) {
    const rows = await this.query('SELECT * FROM meetings WHERE id = ?', [id]);
    return rows[0] || null;
  }

  async participantJoined(row) {
    await this.query(
      'INSERT INTO meeting_participants (meeting_id, user_id, name, role, joined_at) VALUES (?, ?, ?, ?, ?)',
      [row.meeting_id, row.user_id, row.name ?? null, row.role, row.joined_at],
    );
  }

  async participantLeft(meetingId, userId, leftAt, removed = false) {
    await this.query(
      'UPDATE meeting_participants SET left_at = ?, removed = ? WHERE meeting_id = ? AND user_id = ? AND left_at IS NULL',
      [leftAt, removed ? 1 : 0, meetingId, userId],
    );
  }

  async participantsOf(meetingId) {
    return this.query('SELECT * FROM meeting_participants WHERE meeting_id = ? ORDER BY joined_at', [meetingId]);
  }

  async meetingsFor(userId, limit = 20) {
    return this.query(
      'SELECT * FROM meetings WHERE host_id = ? OR id IN (SELECT meeting_id FROM meeting_participants WHERE user_id = ?) ORDER BY created_at DESC LIMIT ?',
      [userId, userId, limit],
    );
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
