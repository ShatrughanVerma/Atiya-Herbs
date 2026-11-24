const request = require('supertest');
const {buildTestApp} = require('./helpers/testApp');
const {istDay} = require('../src/wellness/dates');
const {TTL_SECONDS} = require('../src/wellness/stepWindow');

let idSeq = 0;
const batch = (steps, minutesAgo = 1, over = {}) => ({
  batchId: `batch-${String(++idSeq).padStart(6, '0')}`,
  steps,
  recordedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  ...over,
});

const api = (t, session) => ({
  send: batches => request(t.app).post('/api/v1/wellness/steps/batches').set(t.bearer(session)).send({batches}),
  recent: () => request(t.app).get('/api/v1/wellness/steps/recent').set(t.bearer(session)),
  today: () => request(t.app).get('/api/v1/wellness/today').set(t.bearer(session)),
  history: () => request(t.app).get('/api/v1/wellness/history?days=7').set(t.bearer(session)),
  rewards: () => request(t.app).get('/api/v1/wellness/rewards').set(t.bearer(session)),
});

describe('step batches', () => {
  test('need a login', async () => {
    const t = buildTestApp();
    expect((await request(t.app).post('/api/v1/wellness/steps/batches').send({batches: [batch(10)]})).status).toBe(401);
    expect((await request(t.app).get('/api/v1/wellness/steps/recent')).status).toBe(401);
  });

  test('batches add up to the day\'s steps, and the answer is today\'s whole view', async () => {
    const t = buildTestApp();
    const w = api(t, await t.login());
    const res = await w.send([batch(100), batch(120)]).expect(200);
    expect(res.body.steps).toMatchObject({count: 220, goal: 6000, distanceKm: 0.17, kcal: 9});
    expect(res.body.batches).toEqual({received: 2, added: 2, duplicates: 0});
    const more = await w.send([batch(30)]).expect(200);
    expect(more.body.steps.count).toBe(250);
    expect(t.prisma.wellnessStepBatch.rows).toHaveLength(3);
  });

  test('a batch sent again (a retry after a bad connection) is counted once', async () => {
    const t = buildTestApp();
    const w = api(t, await t.login());
    const same = batch(500);
    await w.send([same]).expect(200);
    const again = await w.send([same]).expect(200);
    expect(again.body.steps.count).toBe(500);
    expect(again.body.batches).toEqual({received: 1, added: 0, duplicates: 1});
    const twice = await w.send([batch(40, 1, {batchId: 'same-in-one-request'}), batch(40, 1, {batchId: 'same-in-one-request'})]).expect(200);
    expect(twice.body.steps.count).toBe(540);
    expect(twice.body.batches).toEqual({received: 2, added: 1, duplicates: 1});
  });

  test('two people can use the same batch id', async () => {
    const t = buildTestApp();
    const asha = api(t, await t.login('9876543210'));
    const ravi = api(t, await t.login('9123456780'));
    const shared = batch(100, 1, {batchId: 'phone-batch-0001'});
    await asha.send([shared]).expect(200);
    expect((await ravi.send([shared]).expect(200)).body.steps.count).toBe(100);
  });

  test('steps counted offline and sent a day later land on the day they were counted', async () => {
    const t = buildTestApp();
    const w = api(t, await t.login());
    const res = await w.send([batch(3000, 30 * 60), batch(50, 1)]).expect(200); // 30 hours ago, and just now
    expect(res.body.steps.count).toBe(50); // today has only the new one
    const history = (await w.history().expect(200)).body.items;
    const yesterday = history.find(item => item.day !== istDay());
    expect(yesterday.steps).toBe(3000);
  });

  test('a day never goes above 100,000 steps', async () => {
    const t = buildTestApp();
    const w = api(t, await t.login());
    const res = await w.send(Array.from({length: 6}, () => batch(20_000))).expect(200);
    expect(res.body.steps.count).toBe(100_000);
  });

  test('the step goal reached through batches pays the points, once', async () => {
    const t = buildTestApp();
    const w = api(t, await t.login());
    await w.send([batch(3000, 5), batch(3000, 4)]).expect(200);
    const rewards = (await w.rewards().expect(200)).body;
    expect(rewards.history.map(row => row.label).sort()).toEqual(['Badge: First steps', 'Step goal reached']);
    await w.send([batch(500, 1)]).expect(200);
    expect((await w.rewards()).body.balance).toBe(rewards.balance);
  });

  test('bad batches are refused and nothing is saved', async () => {
    const t = buildTestApp();
    const w = api(t, await t.login());
    const bad = [
      [],
      [batch(0)],
      [batch(20_001)],
      [batch(10.5)],
      [batch(10, 1, {batchId: 'short'})],
      [batch(10, 1, {batchId: 'has spaces in it!'})],
      [batch(10, -30)], // in the future
      [batch(10, 60 * 24 * 8)], // older than 7 days
      [batch(10, 1, {recordedAt: 'yesterday'})],
      [{...batch(10), extra: true}],
      Array.from({length: 101}, () => batch(1)),
    ];
    for (const batches of bad) {
      expect((await w.send(batches)).status).toBe(400);
    }
    expect((await request(t.app).post('/api/v1/wellness/steps/batches').set(t.bearer(await t.login())).send({batches: [batch(10)], userId: 'x'})).status).toBe(400);
    expect(t.prisma.wellnessStepBatch.rows).toHaveLength(0);
  });

  test('deleting the account removes the batches', async () => {
    const t = buildTestApp();
    const session = await t.login();
    await api(t, session).send([batch(100)]).expect(200);
    await request(t.app).delete('/api/v1/users/me').set(t.bearer(session)).expect(204);
    expect(t.prisma.wellnessStepBatch.rows).toHaveLength(0);
  });
});

describe('the last 10 minutes in Redis', () => {
  test('the steps of the last 10 minutes, minute by minute, with the key expiring after 600 seconds', async () => {
    const t = buildTestApp();
    const session = await t.login();
    const w = api(t, session);
    await w.send([batch(100, 0.2), batch(120, 1.5), batch(150, 4.5)]).expect(200);
    const res = (await w.recent().expect(200)).body;
    expect(res).toMatchObject({available: true, windowSeconds: 600, steps: 370, batches: 3});
    expect(res.perMinute).toHaveLength(10);
    expect(res.perMinute[9]).toBe(100); // the newest minute is last
    expect(res.perMinute[8]).toBe(120);
    expect(res.perMinute[5]).toBe(150);
    expect(res.perMinute.reduce((a, b) => a + b, 0)).toBe(370);
    expect(t.redis.ttls.get(`steps:window:${session.user.id}`)).toBe(TTL_SECONDS);
  });

  test('an older batch is in the day\'s total but not in the 10-minute window', async () => {
    const t = buildTestApp();
    const w = api(t, await t.login());
    const res = await w.send([batch(500, 30), batch(40, 2)]).expect(200);
    expect(res.body.steps.count).toBe(540);
    expect((await w.recent()).body).toMatchObject({steps: 40, batches: 1});
  });

  test('the window slides: after ten minutes the steps leave it, the day\'s total stays', async () => {
    const t = buildTestApp();
    const w = api(t, await t.login());
    await w.send([batch(80, 1)]).expect(200);
    expect((await w.recent()).body.steps).toBe(80);
    const spy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000);
    try {
      expect((await w.recent()).body).toMatchObject({available: true, steps: 0, batches: 0});
    } finally {
      spy.mockRestore();
    }
    expect((await w.today()).body.steps.count).toBe(80);
  });

  test('a batch sent twice is one member of the window', async () => {
    const t = buildTestApp();
    const w = api(t, await t.login());
    const same = batch(60, 1);
    await w.send([same]).expect(200);
    await w.send([same]).expect(200);
    expect((await w.recent()).body).toMatchObject({steps: 60, batches: 1});
  });

  test('every person has their own window', async () => {
    const t = buildTestApp();
    const asha = api(t, await t.login('9876543210'));
    const ravi = api(t, await t.login('9123456780'));
    await asha.send([batch(200, 1)]).expect(200);
    expect((await ravi.recent()).body).toMatchObject({available: true, steps: 0, batches: 0});
  });

  test('when Redis is down the steps are still saved, and the window says it is not available', async () => {
    const t = buildTestApp();
    const w = api(t, await t.login());
    t.redis.breakIt();
    const res = await w.send([batch(250, 1)]).expect(200);
    expect(res.body.steps.count).toBe(250);
    expect(t.prisma.wellnessStepBatch.rows).toHaveLength(1);
    expect((await w.recent().expect(200)).body).toEqual({available: false});
    t.redis.fixIt();
    expect((await w.recent()).body).toMatchObject({available: true});
  });

  test('without Redis at all the steps work and the window is simply off', async () => {
    const t = buildTestApp({}, {redis: null});
    const w = api(t, await t.login());
    expect((await w.send([batch(90, 1)]).expect(200)).body.steps.count).toBe(90);
    expect((await w.recent().expect(200)).body).toEqual({available: false});
  });
});
