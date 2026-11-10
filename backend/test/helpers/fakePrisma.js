const {randomUUID} = require('node:crypto');

// A small in-memory stand-in for the Prisma client, so the whole API can be tested without a MySQL server.
// It supports exactly the query shapes the app uses (equality, null, in, contains, OR, gt/gte/lt/lte, increment /
// decrement, orderBy, skip / take, transactions that roll back) and refuses anything else, so a test fails loudly
// if the app starts using a query this fake does not know.

const matches = (row, where = {}) =>
  Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') {
      return condition.some(part => matches(row, part));
    }
    if (key === 'AND') {
      return condition.every(part => matches(row, part));
    }
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
          case 'in':
            return value.includes(actual);
          case 'notIn':
            return !value.includes(actual);
          case 'not':
            return value === null ? actual !== null && actual !== undefined : actual !== value;
          case 'contains':
            return typeof actual === 'string' && actual.toLowerCase().includes(String(value).toLowerCase());
          default:
            throw new Error(`fakePrisma: unsupported filter "${op}"`);
        }
      });
    }
    return actual === condition;
  });

const applyChanges = (row, data) => {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value)) {
      if ('increment' in value) {
        row[key] = (row[key] ?? 0) + value.increment;
      } else if ('decrement' in value) {
        row[key] = (row[key] ?? 0) - value.decrement;
      } else if (key === 'images' || key === 'benefits' || key === 'shippingAddress') {
        row[key] = value; // a JSON column holding an object
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

const sortRows = (found, orderBy) => {
  const orders = (Array.isArray(orderBy) ? orderBy : [orderBy]).filter(Boolean);
  if (!orders.length) {
    return found;
  }
  return [...found].sort((a, b) => {
    for (const order of orders) {
      const [field, direction] = Object.entries(order)[0];
      if (a[field] < b[field]) {
        return direction === 'desc' ? 1 : -1;
      }
      if (a[field] > b[field]) {
        return direction === 'desc' ? -1 : 1;
      }
    }
    return firstDirection(orders) === 'desc' ? b._seq - a._seq : a._seq - b._seq; // stable: newest last unless asked
  });
};
const firstDirection = orders => Object.values(orders[0])[0];

function createTable({defaults, unique = []}) {
  let rows = [];
  let sequence = 0;
  const copy = row => {
    if (!row) {
      return null;
    }
    const {_seq, ...rest} = row; // eslint-disable-line no-unused-vars
    return {...rest};
  };

  return {
    get rows() {
      return rows;
    },
    snapshot: () => ({rows: rows.map(row => ({...row})), sequence}),
    restore: saved => {
      rows = saved.rows;
      sequence = saved.sequence;
    },
    async findUnique({where}) {
      return copy(rows.find(row => matches(row, where)));
    },
    async findFirst({where, orderBy} = {}) {
      return copy(sortRows(rows.filter(row => matches(row, where)), orderBy)[0]);
    },
    async findMany({where, orderBy, skip = 0, take} = {}) {
      const found = sortRows(rows.filter(row => matches(row, where)), orderBy);
      return found.slice(skip, take === undefined ? undefined : skip + take).map(copy);
    },
    async aggregate({where, _sum = {}}) {
      const found = rows.filter(row => matches(row, where));
      return {_sum: Object.fromEntries(Object.keys(_sum).map(field => [field, found.length ? found.reduce((total, row) => total + (row[field] ?? 0), 0) : null]))};
    },
    async count({where} = {}) {
      return rows.filter(row => matches(row, where)).length;
    },
    async create({data}) {
      const row = {...defaults(), ...data, _seq: sequence++};
      for (const key of unique) {
        if (row[key] !== null && row[key] !== undefined && rows.some(other => other[key] === row[key])) {
          throw Object.assign(new Error(`Unique constraint failed on ${key}`), {code: 'P2002'});
        }
      }
      rows.push(row);
      return copy(row);
    },
    async createMany({data}) {
      for (const item of data) {
        await this.create({data: item});
      }
      return {count: data.length};
    },
    async update({where, data}) {
      const row = rows.find(candidate => matches(candidate, where));
      if (!row) {
        throw Object.assign(new Error('Record to update not found'), {code: 'P2025'});
      }
      for (const key of unique) {
        const value = data[key];
        if (value !== null && value !== undefined && rows.some(other => other !== row && other[key] === value)) {
          throw Object.assign(new Error(`Unique constraint failed on ${key}`), {code: 'P2002'});
        }
      }
      applyChanges(row, data);
      return copy(row);
    },
    async updateMany({where, data}) {
      const found = rows.filter(row => matches(row, where));
      found.forEach(row => applyChanges(row, data));
      return {count: found.length};
    },
    async delete({where}) {
      const index = rows.findIndex(row => matches(row, where));
      if (index === -1) {
        throw Object.assign(new Error('Record to delete not found'), {code: 'P2025'});
      }
      return copy(rows.splice(index, 1)[0]);
    },
    async deleteMany({where} = {}) {
      const before = rows.length;
      rows = rows.filter(row => !matches(row, where));
      return {count: before - rows.length};
    },
  };
}

function createFakePrisma() {
  let creditEntrySeq = 0;
  let videoAuditSeq = 0;
  let userSeq = 0;
  let videoNoSeq = 0;
  const now = () => new Date();
  const withId = extra => () => ({id: randomUUID(), ...extra});
  const tables = {
    user: createTable({
      unique: ['mobile', 'email'],
      defaults: () => ({
        id: randomUUID(),
        name: null,
        email: null,
        passwordHash: null,
        failedLoginCount: 0,
        lockedUntil: null,
        roleId: 14,
        credits: 0,
        patientNo: ++userSeq,
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
    category: createTable({defaults: () => ({sortOrder: 0})}),
    concern: createTable({defaults: () => ({sortOrder: 0})}),
    product: createTable({
      defaults: () => ({
        stock: 0,
        description: '',
        benefits: null,
        howToUse: null,
        ingredients: null,
        size: null,
        badge: null,
        bestseller: false,
        rating: 0,
        reviewCount: 0,
        active: true,
        createdAt: now(),
        updatedAt: now(),
      }),
    }),
    productConcern: createTable({defaults: () => ({})}),
    banner: createTable({defaults: withId({badge: null, gradient: null, concernId: null, categoryId: null, sortOrder: 0, active: true})}),
    coupon: createTable({defaults: () => ({minSubtotal: 0, maxDiscount: null, expiresAt: null, active: true})}),
    cartItem: createTable({defaults: () => ({id: randomUUID(), createdAt: now(), updatedAt: now()})}),
    address: createTable({defaults: () => ({id: randomUUID(), line2: null, isDefault: false, createdAt: now(), updatedAt: now()})}),
    order: createTable({
      unique: ['orderNumber'],
      defaults: () => ({
        id: randomUUID(),
        status: 'placed',
        paymentMethod: 'cod',
        discount: 0,
        shippingFee: 0,
        couponCode: null,
        cancelledAt: null,
        createdAt: now(),
        updatedAt: now(),
      }),
    }),
    orderItem: createTable({defaults: () => ({id: randomUUID(), image: null})}),
    clinic: createTable({defaults: () => ({pincode: null, address: null, phone: null, timings: null, active: true, createdAt: now(), updatedAt: now()})}),
    doctor: createTable({
      defaults: () => ({userId: null, clinicId: null, system: null, concerns: null, photoUrl: null, qualifications: null, experienceYears: 0, languages: null, bio: null, rating: 0, reviewCount: 0, active: true, createdAt: now(), updatedAt: now()}),
    }),
    doctorSchedule: createTable({defaults: () => ({slotMinutes: 20})}),
    appointment: createTable({
      unique: ['number', 'slotKey'],
      defaults: () => ({id: randomUUID(), clinicId: null, adminNote: null, cancelReason: null, completedAt: null, status: 'booked', startsAt: null, endsAt: null, slotKey: null, preferredDate: null, forSelf: true, city: null, concern: null, duration: null, creditsUsed: 0, reason: null, paymentStatus: 'pay_later', createdAt: now(), updatedAt: now()}),
    }),
    creditEntry: createTable({defaults: () => ({id: ++creditEntrySeq, appointmentId: null, createdAt: now()})}),
    consultVideo: createTable({
      defaults: () => ({id: randomUUID(), videoNo: ++videoNoSeq, fileName: null, sizeBytes: null, durationSec: null, status: 'uploading', failedReason: null, consentAt: null, uploadedAt: null, legalHold: false, deletedAt: null, removedBy: null, createdAt: now()}),
    }),
    videoChunk: createTable({defaults: () => ({})}),
    videoAudit: createTable({defaults: () => ({id: ++videoAuditSeq, userId: null, ip: null, createdAt: now()})}),
    callLog: createTable({
      unique: ['externalId'],
      defaults: () => ({id: randomUUID(), externalId: null, calleeMobile: null, meetingId: null, title: null, endedAt: null, durationSec: 0, createdAt: now()}),
    }),
    meetingMessage: createTable({
      unique: ['externalId'],
      defaults: () => ({id: randomUUID(), externalId: null, toMobile: null, createdAt: now()}),
    }),
  };

  const db = {
    ...tables,
    ready: true,
    async $queryRaw() {
      if (!this.ready) {
        throw new Error('database is down');
      }
      return [{ok: 1}];
    },
    // Like Prisma's interactive transaction: if the function throws, every change it made is undone
    async $transaction(work) {
      const saved = Object.fromEntries(Object.entries(tables).map(([name, table]) => [name, table.snapshot()]));
      try {
        return await work(db);
      } catch (error) {
        Object.entries(saved).forEach(([name, state]) => tables[name].restore(state));
        throw error;
      }
    },
  };
  return db;
}

module.exports = {createFakePrisma};
