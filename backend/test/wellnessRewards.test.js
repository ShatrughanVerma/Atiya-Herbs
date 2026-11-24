const request = require('supertest');
const {buildTestApp} = require('./helpers/testApp');
const {addDays, istDay, weekStartOf} = require('../src/wellness/dates');
const {BADGES, CHALLENGES, POINTS} = require('../src/wellness/rewardsRules');

const api = (t, session) => ({
  today: () => request(t.app).get('/api/v1/wellness/today').set(t.bearer(session)),
  water: ml => request(t.app).post('/api/v1/wellness/water').set(t.bearer(session)).send({ml}),
  mood: mood => request(t.app).put('/api/v1/wellness/mood').set(t.bearer(session)).send({mood}),
  steps: steps => request(t.app).put('/api/v1/wellness/steps').set(t.bearer(session)).send({steps}),
  settings: body => request(t.app).put('/api/v1/wellness/settings').set(t.bearer(session)).send(body),
  rewards: () => request(t.app).get('/api/v1/wellness/rewards').set(t.bearer(session)),
  redeem: points => request(t.app).post('/api/v1/wellness/rewards/redeem').set(t.bearer(session)).send({points}),
});

// Writes points straight into the database (as if they were earned on other days)
let keySeq = 0;
const addPoints = (t, userId, rows) =>
  rows.forEach(row =>
    t.prisma.wellnessPoint.create({data: {userId, reason: 'water', ref: null, day: null, refKey: `${userId}:test:${keySeq++}`, ...row}}),
  );

const labels = body => body.history.map(row => row.label);

describe('rewards: the start', () => {
  test('needs a login', async () => {
    const t = buildTestApp();
    expect((await request(t.app).get('/api/v1/wellness/rewards')).status).toBe(401);
    expect((await request(t.app).post('/api/v1/wellness/rewards/redeem').send({points: 500})).status).toBe(401);
  });

  test('a new person has no points, every badge to win, three challenges and 500 points to go', async () => {
    const t = buildTestApp();
    const res = await api(t, await t.login()).rewards().expect(200);
    expect(res.body).toMatchObject({balance: 0, rupees: 0, pointsPerRupee: 10});
    expect(res.body.redeem).toMatchObject({unit: 500, unitRupees: 50, points: 0, rupees: 0, canRedeem: false, pointsToGo: 500});
    expect(res.body.badges).toHaveLength(BADGES.length);
    expect(res.body.badges.every(b => !b.earned && b.progress === 0)).toBe(true);
    expect(res.body.challenges.map(c => [c.id, c.progress, c.target])).toEqual(CHALLENGES.map(c => [c.id, 0, c.target]));
    expect(res.body.earn.map(rule => rule.points)).toEqual([10, 10, 5, 50, 25, 30]);
    expect(res.body.history).toEqual([]);
  });

  test('the Home view carries the points and the first four badges', async () => {
    const t = buildTestApp();
    const res = await api(t, await t.login()).today().expect(200);
    expect(res.body.rewards).toMatchObject({balance: 0, rupees: 0, badgesEarned: 0, badgesTotal: BADGES.length});
    expect(res.body.rewards.badges.map(b => b.id)).toEqual(['first_checkin', 'streak3', 'streak7', 'streak14']);
  });
});

describe('rewards: earning', () => {
  test('the water goal pays 10 points, once a day', async () => {
    const t = buildTestApp();
    const w = api(t, await t.login());
    await w.water(1500);
    expect((await w.rewards()).body.balance).toBe(0); // not reached yet
    await w.water(500);
    const res = (await w.rewards()).body;
    expect(res.balance).toBe(POINTS.water);
    expect(labels(res)).toEqual(['Water goal reached']);
    await w.water(250); // more water, the same day: nothing more
    await w.water(-2250);
    await w.water(2000); // taken back and drunk again: nothing more
    expect((await w.rewards()).body.balance).toBe(POINTS.water);
  });

  test('a finished day with its first check-in is 10 + 5 + 25 for the badge: the 40 points of the design', async () => {
    const t = buildTestApp();
    const w = api(t, await t.login());
    await w.water(2000);
    await w.mood('good');
    const res = (await w.rewards()).body;
    expect(res.balance).toBe(POINTS.water + POINTS.complete + POINTS.badge);
    expect(res.balance).toBe(40);
    expect(labels(res).sort()).toEqual(['Badge: First check-in', 'Daily check-in complete', 'Water goal reached']);
    expect(res.badges.find(b => b.id === 'first_checkin')).toMatchObject({earned: true, earnedOn: istDay(), progress: 1});
    expect(res.badges.find(b => b.id === 'water7')).toMatchObject({earned: false, progress: 1, target: 7});
  });

  test('the step goal pays 10, and the "First steps" badge 25', async () => {
    const t = buildTestApp();
    const w = api(t, await t.login());
    await w.steps(5999);
    expect((await w.rewards()).body.balance).toBe(0);
    await w.steps(6000);
    const res = (await w.rewards()).body;
    expect(res.balance).toBe(POINTS.steps + POINTS.badge);
    expect(labels(res).sort()).toEqual(['Badge: First steps', 'Step goal reached']);
  });

  test('a goal that is too easy earns nothing, because points are worth money', async () => {
    const t = buildTestApp();
    const w = api(t, await t.login());
    await w.settings({waterGoalGlasses: 4, glassMl: 250, stepGoal: 1000}).expect(200); // 1,000 ml and 1,000 steps
    await w.water(1000);
    await w.mood('great');
    await w.steps(1500);
    expect((await w.rewards()).body.balance).toBe(0);
  });

  test('turning the goal down later does not pay the day again', async () => {
    const t = buildTestApp();
    const w = api(t, await t.login());
    await w.water(2000);
    await w.settings({waterGoalGlasses: 6}).expect(200); // 1,500 ml, still allowed
    await w.settings({waterGoalGlasses: 8}).expect(200);
    expect((await w.rewards()).body.balance).toBe(POINTS.water);
  });

  test('7 complete days in a row pay 50 more, and the streak badges', async () => {
    const t = buildTestApp();
    const session = await t.login();
    const w = api(t, session);
    const today = istDay();
    for (let back = 1; back <= 6; back += 1) {
      await t.prisma.wellnessDay.create({data: {userId: session.user.id, day: addDays(today, -back), waterMl: 2000, mood: 'good'}});
    }
    await w.water(2000);
    await w.mood('good');
    const res = (await w.rewards()).body;
    expect(labels(res)).toContain('7 days in a row');
    expect(res.history.find(row => row.label === '7 days in a row').points).toBe(POINTS.streak);
    const earned = res.badges.filter(b => b.earned).map(b => b.id).sort();
    expect(earned).toEqual(['first_checkin', 'streak3', 'streak7']);
    expect(res.balance).toBe(POINTS.water + POINTS.complete + POINTS.streak + 3 * POINTS.badge);
    // checking again pays nothing new
    await w.water(250);
    expect((await w.rewards()).body.balance).toBe(res.balance);
  });

  test('a weekly challenge pays 30 when its days are done, and only once a week', async () => {
    const t = buildTestApp();
    const session = await t.login();
    const w = api(t, session);
    const today = istDay();
    const monday = weekStartOf(today);
    const otherDays = Array.from({length: 7}, (_, i) => addDays(monday, i)).filter(day => day !== today).slice(0, 4);
    addPoints(t, session.user.id, otherDays.map(day => ({points: 10, reason: 'water', day})));
    expect((await w.rewards()).body.challenges.find(c => c.id === 'water5')).toMatchObject({progress: 4, done: false});
    await w.water(2000); // the fifth day
    const res = (await w.rewards()).body;
    expect(res.challenges.find(c => c.id === 'water5')).toMatchObject({progress: 5, done: true});
    expect(labels(res)).toContain('Challenge: Reach your water goal on 5 days');
    expect(res.history.find(row => row.label.startsWith('Challenge')).points).toBe(POINTS.challenge);
    await w.water(250);
    expect((await w.rewards()).body.history.filter(row => row.label.startsWith('Challenge'))).toHaveLength(1);
  });

  test('the "Point collector" badge is earned by the points themselves', async () => {
    const t = buildTestApp();
    const session = await t.login();
    addPoints(t, session.user.id, [{points: 990, reason: 'water', day: '2026-01-01'}]);
    const w = api(t, session);
    await w.water(2000); // +10 for the water makes 1,000 earned
    const res = (await w.rewards()).body;
    expect(res.badges.find(b => b.id === 'point_collector').earned).toBe(true);
  });
});

describe('rewards: wallet', () => {
  test('500 points become Rs 50 of credits, with a ledger entry', async () => {
    const t = buildTestApp();
    const session = await t.login();
    const w = api(t, session);
    addPoints(t, session.user.id, [{points: 620}]);
    const before = (await w.rewards()).body;
    expect(before.redeem).toMatchObject({points: 500, rupees: 50, canRedeem: true, pointsToGo: 0});

    const res = await w.redeem(500).expect(200);
    expect(res.body).toMatchObject({balance: 120, added: 50, walletCredits: 50, rupees: 12});
    expect(res.body.wallet).toEqual([expect.objectContaining({points: 500, rupees: 50})]);
    expect(labels(res.body)).toContain('Added to wallet');
    expect(t.prisma.user.rows.find(u => u.id === session.user.id).credits).toBe(50);
    expect(t.prisma.creditEntry.rows).toEqual([expect.objectContaining({userId: session.user.id, delta: 50, reason: 'Wellness points'})]);
  });

  test('the same points cannot be spent twice', async () => {
    const t = buildTestApp();
    const session = await t.login();
    const w = api(t, session);
    addPoints(t, session.user.id, [{points: 600}]);
    await w.redeem(500).expect(200);
    expect((await w.redeem(500)).status).toBe(409);
    expect(t.prisma.user.rows.find(u => u.id === session.user.id).credits).toBe(50);
  });

  test('too few points, odd amounts and extra fields are refused, and nothing changes', async () => {
    const t = buildTestApp();
    const session = await t.login();
    const w = api(t, session);
    addPoints(t, session.user.id, [{points: 450}]);
    expect((await w.redeem(500)).status).toBe(409);
    expect((await w.redeem(499)).status).toBe(400);
    expect((await w.redeem(0)).status).toBe(400);
    expect((await w.redeem(-500)).status).toBe(400);
    expect((await request(t.app).post('/api/v1/wellness/rewards/redeem').set(t.bearer(session)).send({points: 500, rupees: 9999})).status).toBe(400);
    expect(t.prisma.user.rows.find(u => u.id === session.user.id).credits).toBe(0);
    expect((await w.rewards()).body.balance).toBe(450);
  });

  test('points are private, and deleting the account removes them', async () => {
    const t = buildTestApp();
    const asha = await t.login('9876543210');
    const ravi = api(t, await t.login('9123456780'));
    addPoints(t, asha.user.id, [{points: 700}]);
    expect((await ravi.rewards()).body.balance).toBe(0);
    await request(t.app).delete('/api/v1/users/me').set(t.bearer(asha)).expect(204);
    expect(t.prisma.wellnessPoint.rows).toHaveLength(0);
  });
});
