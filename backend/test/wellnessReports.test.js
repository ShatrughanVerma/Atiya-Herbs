const request = require('supertest');
const {buildTestApp} = require('./helpers/testApp');
const {addDays, addMonths, daysBetween, istDay, monthEndOf, monthName, monthStartOf, shortDay, weekStartOf} = require('../src/wellness/dates');

const report = (t, session, range) =>
  request(t.app).get(`/api/v1/wellness/reports${range ? `?range=${range}` : ''}`).set(t.bearer(session));

describe('date helpers of the reports', () => {
  test('weeks run Monday to Sunday', () => {
    expect(weekStartOf('2026-11-24')).toBe('2026-11-23'); // a Tuesday
    expect(weekStartOf('2026-11-23')).toBe('2026-11-23'); // the Monday itself
    expect(weekStartOf('2026-11-29')).toBe('2026-11-23'); // the Sunday
    expect(weekStartOf('2026-12-01')).toBe('2026-11-30');
  });

  test('months, in every length and across a year', () => {
    expect(monthStartOf('2026-11-24')).toBe('2026-11-01');
    expect(monthEndOf('2026-11-24')).toBe('2026-11-30');
    expect(monthEndOf('2026-02-10')).toBe('2026-02-28');
    expect(monthEndOf('2028-02-10')).toBe('2028-02-29');
    expect(addMonths('2026-11-01', -2)).toBe('2026-09-01');
    expect(addMonths('2026-01-01', -1)).toBe('2025-12-01');
    expect(daysBetween('2026-11-24', '2026-11-30')).toBe(6);
  });

  test('labels', () => {
    expect(shortDay('2026-11-09')).toBe('9 Nov');
    expect(monthName('2026-11-09')).toBe('November 2026');
  });
});

describe('reports', () => {
  test('need a login, and the range is one of three', async () => {
    const t = buildTestApp();
    expect((await request(t.app).get('/api/v1/wellness/reports')).status).toBe(401);
    const session = await t.login();
    expect((await report(t, session, 'yearly')).status).toBe(400);
    expect((await report(t, session)).body.range).toBe('weekly'); // the default
  });

  test('a new person has empty reports, measured over the days gone', async () => {
    const t = buildTestApp();
    const res = (await report(t, await t.login(), 'weekly').expect(200)).body;
    expect(res.periods).toHaveLength(8);
    expect(res.goals).toEqual({waterGlasses: 8, steps: 6000});
    expect(res.summary).toMatchObject({waterPercent: 0, glassesPerDay: 0, stepsPerDay: 0, totalSteps: 0, completeDays: 0, medicinePercent: null});
    const today = istDay();
    expect(res.summary.from).toBe(weekStartOf(today));
    expect(res.summary.days).toBe(daysBetween(weekStartOf(today), today) + 1); // only the days that have come
  });

  test('a full week: water, steps, distance, moods and complete days', async () => {
    const t = buildTestApp();
    const session = await t.login();
    const lastWeek = addDays(weekStartOf(istDay()), -7);
    const mine = {userId: session.user.id};
    await t.prisma.wellnessDay.create({data: {...mine, day: lastWeek, waterMl: 2000, steps: 4000, mood: 'good'}}); // a complete day
    await t.prisma.wellnessDay.create({data: {...mine, day: addDays(lastWeek, 1), waterMl: 1000, steps: 2000, mood: 'low'}});
    const res = (await report(t, session, 'weekly').expect(200)).body;
    const week = res.periods[1];
    expect(week).toMatchObject({from: lastWeek, to: addDays(lastWeek, 6), days: 7});
    expect(week.label).toBe(`${shortDay(lastWeek)} – ${shortDay(addDays(lastWeek, 6))}`);
    expect(week.waterPercent).toBe(21); // (100 + 50) / 7 days
    expect(week.glassesPerDay).toBe(1.7); // 12 glasses / 7 days
    expect(week).toMatchObject({stepsPerDay: 857, totalSteps: 6000, distanceKm: 4.5, kcal: 240, completeDays: 1});
    expect(week.moods).toEqual({great: 0, good: 1, okay: 0, low: 1});
  });

  test('monthly: six months, the current one measured over the days gone', async () => {
    const t = buildTestApp();
    const session = await t.login();
    const today = istDay();
    await t.prisma.wellnessDay.create({data: {userId: session.user.id, day: monthStartOf(today), waterMl: 2000, steps: 1000, mood: 'great'}});
    const res = (await report(t, session, 'monthly').expect(200)).body;
    expect(res.periods).toHaveLength(6);
    expect(res.summary.label).toBe(monthName(today));
    expect(res.periods[1].label).toBe(monthName(addMonths(monthStartOf(today), -1)));
    expect(res.summary).toMatchObject({from: monthStartOf(today), to: monthEndOf(today), days: Number(today.slice(8)), totalSteps: 1000, completeDays: 1});
  });

  test('daily: the last 14 days, newest first, each one a day', async () => {
    const t = buildTestApp();
    const session = await t.login();
    const today = istDay();
    await t.prisma.wellnessDay.create({data: {userId: session.user.id, day: addDays(today, -2), waterMl: 500, steps: 800, mood: 'okay'}});
    const res = (await report(t, session, 'daily').expect(200)).body;
    expect(res.periods).toHaveLength(14);
    expect(res.periods[0]).toMatchObject({from: today, to: today, days: 1});
    expect(res.periods[2]).toMatchObject({from: addDays(today, -2), waterPercent: 25, totalSteps: 800, moods: {okay: 1, great: 0, good: 0, low: 0}});
    expect(res.periods[2].label).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), \d{1,2} [A-Z][a-z]{2}$/);
  });

  test('another person\'s days are never counted', async () => {
    const t = buildTestApp();
    const asha = await t.login('9876543210');
    const ravi = await t.login('9123456780');
    await t.prisma.wellnessDay.create({data: {userId: asha.user.id, day: istDay(), waterMl: 2000, steps: 9000, mood: 'good'}});
    const res = (await report(t, ravi, 'daily').expect(200)).body;
    expect(res.summary).toMatchObject({totalSteps: 0, waterPercent: 0, completeDays: 0});
  });
});
