const request = require('supertest');
const {buildTestApp} = require('./helpers/testApp');
const {addDays, istDay} = require('../src/wellness/dates');

const api = (t, session) => ({
  today: () => request(t.app).get('/api/v1/wellness/today').set(t.bearer(session)),
  water: ml => request(t.app).post('/api/v1/wellness/water').set(t.bearer(session)).send({ml}),
  mood: mood => request(t.app).put('/api/v1/wellness/mood').set(t.bearer(session)).send({mood}),
  history: query => request(t.app).get(`/api/v1/wellness/history${query ?? ''}`).set(t.bearer(session)),
  settings: body => request(t.app).put('/api/v1/wellness/settings').set(t.bearer(session)).send(body),
  steps: steps => request(t.app).put('/api/v1/wellness/steps').set(t.bearer(session)).send({steps}),
  walk: body => request(t.app).post('/api/v1/wellness/walks').set(t.bearer(session)).send(body),
  walks: query => request(t.app).get(`/api/v1/wellness/walks${query ?? ''}`).set(t.bearer(session)),
});

describe('dates', () => {
  test('the Indian day starts at 18:30 UTC', () => {
    expect(istDay(new Date('2026-11-24T18:29:00Z'))).toBe('2026-11-24');
    expect(istDay(new Date('2026-11-24T18:30:00Z'))).toBe('2026-11-25');
  });

  test('days can be added and taken away, across months and years', () => {
    expect(addDays('2026-11-24', 3)).toBe('2026-11-27');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('wellness: today', () => {
  test('needs a login', async () => {
    const t = buildTestApp();
    expect((await request(t.app).get('/api/v1/wellness/today')).status).toBe(401);
    expect((await request(t.app).post('/api/v1/wellness/water').send({ml: 250})).status).toBe(401);
  });

  test('a new person starts with the default goal and an empty day', async () => {
    const t = buildTestApp();
    const res = await api(t, await t.login()).today().expect(200);
    expect(res.body.day).toBe(istDay());
    expect(res.body.settings).toMatchObject({waterGoalGlasses: 8, glassMl: 250, stepGoal: 6000});
    expect(res.body.steps).toEqual({count: 0, goal: 6000, percent: 0, distanceKm: 0, kcal: 0, perStep: {km: 0.00075, kcal: 0.04}});
    expect(res.body.water).toEqual({ml: 0, glasses: 0, goalMl: 2000, goalGlasses: 8, percent: 0});
    expect(res.body.mood).toBeNull();
    // no medicines are due, so that goal is already done: 1 of 3, like the screen shows
    expect(res.body.goals).toMatchObject({done: 1, total: 3, percent: 33, complete: false});
    expect(res.body.streak).toEqual({current: 0, best: 0});
    expect(res.body.week).toHaveLength(7);
    expect(res.body.week[6].day).toBe(istDay());
  });
});

describe('wellness: water and mood', () => {
  test('glasses add up, and taking one back never goes below zero', async () => {
    const t = buildTestApp();
    const w = api(t, await t.login());
    await w.water(250).expect(200);
    const two = await w.water(250).expect(200);
    expect(two.body.water).toMatchObject({ml: 500, glasses: 2, percent: 25});
    const back = await w.water(-250).expect(200);
    expect(back.body.water.ml).toBe(250);
    const floor = await w.water(-2000).expect(200);
    expect(floor.body.water.ml).toBe(0);
  });

  test('the day has a ceiling, so a slip of the finger cannot make it absurd', async () => {
    const t = buildTestApp();
    const w = api(t, await t.login());
    for (let i = 0; i < 7; i += 1) {
      await w.water(2000).expect(200);
    }
    expect((await w.today()).body.water.ml).toBe(10_000);
  });

  test('reaching the water goal and choosing a mood completes the day', async () => {
    const t = buildTestApp();
    const w = api(t, await t.login());
    await w.water(2000).expect(200);
    const water = await w.today();
    expect(water.body.goals).toMatchObject({done: 2, complete: false});
    const done = await w.mood('good').expect(200);
    expect(done.body.mood).toBe('good');
    expect(done.body.goals).toMatchObject({done: 3, percent: 100, complete: true});
    expect(done.body.streak.current).toBe(1);
    const cleared = await w.mood(null).expect(200);
    expect(cleared.body.mood).toBeNull();
  });

  test('bad input is refused', async () => {
    const t = buildTestApp();
    const w = api(t, await t.login());
    expect((await w.water(0)).status).toBe(400);
    expect((await w.water(5000)).status).toBe(400);
    expect((await w.water('lots')).status).toBe(400);
    expect((await w.mood('angry')).status).toBe(400);
    expect((await request(t.app).post('/api/v1/wellness/water').set(t.bearer(await t.login())).send({ml: 250, userId: 'someone'})).status).toBe(400);
  });

  test('one person never sees or changes another person\'s day', async () => {
    const t = buildTestApp();
    const asha = api(t, await t.login('9876543210'));
    const ravi = api(t, await t.login('9123456780'));
    await asha.water(500);
    await asha.mood('great');
    const other = await ravi.today();
    expect(other.body.water.ml).toBe(0);
    expect(other.body.mood).toBeNull();
  });
});

describe('wellness: goals', () => {
  test('a bigger goal or glass changes the numbers', async () => {
    const t = buildTestApp();
    const w = api(t, await t.login());
    await w.water(500);
    const res = await w.settings({waterGoalGlasses: 10, glassMl: 200}).expect(200);
    expect(res.body.settings).toMatchObject({waterGoalGlasses: 10, glassMl: 200, stepGoal: 6000});
    expect(res.body.water).toMatchObject({ml: 500, glasses: 2, goalMl: 2000, goalGlasses: 10, percent: 25});
    const again = await w.settings({glassMl: 500}).expect(200); // one setting at a time
    expect(again.body.settings).toMatchObject({waterGoalGlasses: 10, glassMl: 500, stepGoal: 6000});
  });

  test('goals out of range, empty or with extra fields are refused', async () => {
    const t = buildTestApp();
    const w = api(t, await t.login());
    expect((await w.settings({waterGoalGlasses: 0})).status).toBe(400);
    expect((await w.settings({waterGoalGlasses: 31})).status).toBe(400);
    expect((await w.settings({glassMl: 50})).status).toBe(400);
    expect((await w.settings({})).status).toBe(400);
    expect((await w.settings({waterGoalGlasses: 8, extra: 1})).status).toBe(400);
  });
});

describe('wellness: reminder settings', () => {
  test('a new person has the usual reminders, as times after midnight', async () => {
    const t = buildTestApp();
    const res = await api(t, await t.login()).today().expect(200);
    expect(res.body.defaults).toEqual(res.body.settings); // nothing is changed yet
    expect(res.body.settings).toEqual({
      waterGoalGlasses: 8,
      glassMl: 250,
      stepGoal: 6000,
      waterReminderOn: true,
      waterEveryMin: 120,
      waterFromMin: 540, // 9:00 AM
      waterUntilMin: 1260, // 9:00 PM
      medMorningMin: 480,
      medAfternoonMin: 780,
      medEveningMin: 1080,
      medNightMin: 1260,
      checkinOn: true,
      checkinAtMin: 1200, // 8:00 PM
    });
  });

  test('reminders can be switched off and their times changed, one at a time', async () => {
    const t = buildTestApp();
    const w = api(t, await t.login());
    const off = await w.settings({waterReminderOn: false, checkinOn: false}).expect(200);
    expect(off.body.settings).toMatchObject({waterReminderOn: false, checkinOn: false, waterEveryMin: 120});
    const times = await w.settings({waterEveryMin: 60, waterFromMin: 480, medMorningMin: 450, checkinAtMin: 1290}).expect(200);
    expect(times.body.settings).toMatchObject({waterReminderOn: false, waterEveryMin: 60, waterFromMin: 480, medMorningMin: 450, checkinAtMin: 1290});
  });

  test('the water reminders must start before they end, also against the saved value', async () => {
    const t = buildTestApp();
    const w = api(t, await t.login());
    expect((await w.settings({waterFromMin: 600, waterUntilMin: 600})).status).toBe(400);
    expect((await w.settings({waterFromMin: 1300})).status).toBe(400); // the saved "until" is 1260
    expect((await w.settings({waterUntilMin: 500})).status).toBe(400); // the saved "from" is 540
    expect((await w.settings({waterFromMin: 600, waterUntilMin: 1200})).status).toBe(200);
  });

  test('impossible times, intervals and types are refused', async () => {
    const t = buildTestApp();
    const w = api(t, await t.login());
    for (const body of [{medNightMin: 1440}, {medNightMin: -1}, {checkinAtMin: 20.5}, {waterEveryMin: 45}, {waterReminderOn: 'yes'}, {checkinOn: 1}]) {
      expect((await w.settings(body)).status).toBe(400);
    }
  });

  test('going back to the usual settings is just sending them again', async () => {
    const t = buildTestApp();
    const w = api(t, await t.login());
    await w.settings({waterReminderOn: false, waterEveryMin: 30, medNightMin: 1380}).expect(200);
    const back = await w.settings({waterReminderOn: true, waterEveryMin: 120, medNightMin: 1260}).expect(200);
    expect(back.body.settings).toMatchObject({waterReminderOn: true, waterEveryMin: 120, medNightMin: 1260});
  });
});

describe('wellness: steps', () => {
  test('the phone sends its total for the day; the distance and calories follow, and the goal can change', async () => {
    const t = buildTestApp();
    const w = api(t, await t.login());
    const res = await w.steps(3000).expect(200);
    expect(res.body.steps).toMatchObject({count: 3000, goal: 6000, percent: 50, distanceKm: 2.25, kcal: 120});
    expect(res.body.week[6].steps).toBe(3000);
    const bigger = await w.settings({stepGoal: 10000}).expect(200);
    expect(bigger.body.steps).toMatchObject({count: 3000, goal: 10000, percent: 30});
  });

  test('the total only goes up: an older or smaller number never takes steps away', async () => {
    const t = buildTestApp();
    const w = api(t, await t.login());
    await w.steps(4000).expect(200);
    expect((await w.steps(1000).expect(200)).body.steps.count).toBe(4000);
    expect((await w.steps(4500).expect(200)).body.steps.count).toBe(4500);
    expect((await w.steps(100_000).expect(200)).body.steps.count).toBe(100_000);
  });

  test('impossible numbers and goals are refused', async () => {
    const t = buildTestApp();
    const w = api(t, await t.login());
    expect((await w.steps(-1)).status).toBe(400);
    expect((await w.steps(100_001)).status).toBe(400);
    expect((await w.steps(12.5)).status).toBe(400);
    expect((await w.settings({stepGoal: 500})).status).toBe(400);
    expect((await w.settings({stepGoal: 60_000})).status).toBe(400);
  });

  test('a day with only steps shows in the history', async () => {
    const t = buildTestApp();
    const w = api(t, await t.login());
    await w.steps(1200);
    const item = (await w.history('?days=7').expect(200)).body.items[0];
    expect(item).toMatchObject({day: istDay(), steps: 1200, waterMl: 0, complete: false});
  });
});

describe('wellness: walks', () => {
  const walkBody = (over = {}) => ({startedAt: new Date(Date.now() - 20 * 60_000).toISOString(), durationSec: 1200, steps: 2000, ...over});

  test('a finished walk is saved with its distance and calories, and listed newest first', async () => {
    const t = buildTestApp();
    const w = api(t, await t.login());
    const first = await w.walk(walkBody({startedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(), steps: 1000})).expect(201);
    expect(first.body).toMatchObject({steps: 1000, durationSec: 1200, distanceKm: 0.75, kcal: 40});
    await w.walk(walkBody()).expect(201);
    const list = (await w.walks('?days=7').expect(200)).body;
    expect(list.items.map(item => item.steps)).toEqual([2000, 1000]);
  });

  test('a walk that is in the future, too old, too fast or malformed is refused', async () => {
    const t = buildTestApp();
    const w = api(t, await t.login());
    expect((await w.walk(walkBody({startedAt: new Date(Date.now() + 3_600_000).toISOString()}))).status).toBe(400);
    expect((await w.walk(walkBody({startedAt: new Date(Date.now() - 5 * 86_400_000).toISOString()}))).status).toBe(400);
    expect((await w.walk(walkBody({durationSec: 60, steps: 1000}))).status).toBe(400); // 16 steps a second
    expect((await w.walk(walkBody({durationSec: 5}))).status).toBe(400);
    expect((await w.walk(walkBody({startedAt: 'yesterday'}))).status).toBe(400);
    expect((await w.walk({...walkBody(), extra: 1})).status).toBe(400);
    expect(t.prisma.wellnessWalk.rows).toHaveLength(0);
  });

  test('walks are private to the person', async () => {
    const t = buildTestApp();
    const asha = api(t, await t.login('9876543210'));
    const ravi = api(t, await t.login('9123456780'));
    await asha.walk(walkBody()).expect(201);
    expect((await ravi.walks().expect(200)).body.items).toHaveLength(0);
  });
});

describe('wellness: streak and history', () => {
  const completeDay = (t, userId, day) => t.prisma.wellnessDay.create({data: {userId, day, waterMl: 2000, mood: 'good'}});

  test('complete days in a row make the streak; yesterday keeps it alive while today is still open', async () => {
    const t = buildTestApp();
    const session = await t.login();
    const w = api(t, session);
    const today = istDay();
    for (const back of [1, 2, 3, 5]) {
      await completeDay(t, session.user.id, addDays(today, -back));
    }
    const res = await w.today().expect(200);
    expect(res.body.streak).toEqual({current: 3, best: 3}); // 1, 2, 3 days ago; the gap at 4 ends it
    await w.water(2000);
    await w.mood('great');
    expect((await w.today()).body.streak).toEqual({current: 4, best: 4});
  });

  test('a missed day breaks the streak', async () => {
    const t = buildTestApp();
    const session = await t.login();
    await completeDay(t, session.user.id, addDays(istDay(), -2)); // yesterday was missed
    expect((await api(t, session).today()).body.streak).toEqual({current: 0, best: 1});
  });

  test('history lists the days with something in them, newest first', async () => {
    const t = buildTestApp();
    const session = await t.login();
    const w = api(t, session);
    const today = istDay();
    await completeDay(t, session.user.id, addDays(today, -3));
    await t.prisma.wellnessDay.create({data: {userId: session.user.id, day: addDays(today, -40), waterMl: 500}});
    await t.prisma.wellnessDay.create({data: {userId: session.user.id, day: addDays(today, -5)}}); // empty row: left out
    await w.water(250);

    const week = (await w.history('?days=7').expect(200)).body;
    expect(week.items.map(item => item.day)).toEqual([today, addDays(today, -3)]);
    expect(week.items[1]).toMatchObject({waterMl: 2000, glasses: 8, mood: 'good', complete: true});
    expect(week.items[0]).toMatchObject({waterMl: 250, complete: false});

    expect((await w.history().expect(200)).body.items).toHaveLength(2); // 30 days is the default
    expect((await w.history('?days=90').expect(200)).body.items).toHaveLength(3);
    expect((await w.history('?days=10')).status).toBe(400);
  });
});

describe('wellness: account deletion', () => {
  test('deleting the account removes the wellness data too', async () => {
    const t = buildTestApp();
    const session = await t.login();
    const w = api(t, session);
    await w.water(250);
    await w.settings({waterGoalGlasses: 6});
    await w.walk({startedAt: new Date(Date.now() - 600_000).toISOString(), durationSec: 300, steps: 400}).expect(201);
    expect(t.prisma.wellnessDay.rows).toHaveLength(1);
    expect(t.prisma.wellnessWalk.rows).toHaveLength(1);
    await request(t.app).delete('/api/v1/users/me').set(t.bearer(session)).expect(204);
    expect(t.prisma.wellnessDay.rows).toHaveLength(0);
    expect(t.prisma.wellnessSettings.rows).toHaveLength(0);
    expect(t.prisma.wellnessWalk.rows).toHaveLength(0);
  });
});
