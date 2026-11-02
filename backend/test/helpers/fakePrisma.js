const {randomUUID} = require('node:crypto');

// A small in-memory stand-in for the Prisma client, so the whole API can be tested without SQL Server.
// It supports exactly the query shapes the app uses (equality, null, gt/gte/lt/lte, increment, orderBy desc)
// and refuses anything else, so a test fails loudly if the app starts using a query this fake does not know.

const matches = (row, where = {}) =>
  Object.entries(where).every(([key, condition]) => {
    const actual = row[key];
    if (condition === null) {
      return actual === null || actual === undefined;
    }
    if (condition instanceof Date) {
      return actual instanceof Date && actual.getTime() === condition.getTime();
    }
    if (typeof condition === 'object') {
      return Object.entries(condition).every(([op, value]) => {
        switch (op) {
          case 'gte':
            return actual >= value;
          case 'gt':
            return actual > value;
          case 'lt':
            return actual < value;
          case 'lte':
            return actual <= value;
          default:
            throw new Error(`fakePrisma: unsupported filter "${op}"`);
        }
      });
    }
    return actual === condition;
  });

const applyChanges = (row, data) => {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('increment' in value) {
        row[key] = (row[key] ?? 0) + value.increment;
      } else {
        throw new Error(`fakePrisma: unsupported update "${Object.keys(value)[0]}"`);
      }
    } else {
      row[key] = value;
    }
  }
  if ('updatedAt' in row) {
    row.updatedAt = new Date();
  }
};

function createTable({defaults, unique = []}) {
  const rows = [];
  let sequence = 0;
  const copy = row => (row ? {...row} : null);

  return {
    rows,
    async findUnique({where}) {
      return copy(rows.find(row => matches(row, where)));
    },
    async findFirst({where, orderBy} = {}) {
      let found = rows.filter(row => matches(row, where));
      if (orderBy?.createdAt === 'desc') {
        found = [...found].sort((a, b) => b.createdAt - a.createdAt || b._seq - a._seq);
      }
      return copy(found[0]);
    },
    async count({where} = {}) {
      return rows.filter(row => matches(row, where)).length;
    },
    async create({data}) {
      const row = {...defaults(), ...data, _seq: sequence++};
      for (const key of unique) {
        if (rows.some(other => other[key] === row[key])) {
          throw Object.assign(new Error(`Unique constraint failed on ${key}`), {code: 'P2002'});
        }
      }
      rows.push(row);
      return copy(row);
    },
    async update({where, data}) {
      const row = rows.find(candidate => matches(candidate, where));
      if (!row) {
        throw Object.assign(new Error('Record to update not found'), {code: 'P2025'});
      }
      applyChanges(row, data);
      return copy(row);
    },
    async updateMany({where, data}) {
      const found = rows.filter(row => matches(row, where));
      found.forEach(row => applyChanges(row, data));
      return {count: found.length};
    },
  };
}

function createFakePrisma() {
  const now = () => new Date();
  return {
    user: createTable({
      unique: ['mobile'],
      defaults: () => ({
        id: randomUUID(),
        name: null,
        email: null,
        role: 'customer',
        status: 'active',
        createdAt: now(),
        updatedAt: now(),
        lastLoginAt: null,
      }),
    }),
    otpChallenge: createTable({defaults: () => ({id: randomUUID(), attempts: 0, consumedAt: null, requestIp: null, createdAt: now()})}),
    refreshToken: createTable({
      unique: ['tokenHash'],
      defaults: () => ({id: randomUUID(), revokedAt: null, userAgent: null, ip: null, createdAt: now()}),
    }),
    auditLog: createTable({defaults: () => ({userId: null, ip: null, userAgent: null, metadata: null, createdAt: now()})}),
    ready: true,
    async $queryRaw() {
      if (!this.ready) {
        throw new Error('database is down');
      }
      return [{ok: 1}];
    },
  };
}

module.exports = {createFakePrisma};
