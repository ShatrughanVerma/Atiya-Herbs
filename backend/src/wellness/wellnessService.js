const {badRequest} = require('../common/errors');
const {addDays, istDay} = require('./dates');
const {createReportsService} = require('./reportsService');
const {createRewardsService} = require('./rewardsService');
const {createStepWindow} = require('./stepWindow');

const DEFAULT_SETTINGS = {
  waterGoalGlasses: 8,
  glassMl: 250,
  stepGoal: 6000,
  // reminders (times are minutes after midnight)
  waterReminderOn: true,
  waterEveryMin: 120,
  waterFromMin: 9 * 60,
  waterUntilMin: 21 * 60,
  medMorningMin: 8 * 60,
  medAfternoonMin: 13 * 60,
  medEveningMin: 18 * 60,
  medNightMin: 21 * 60,
  checkinOn: true,
  checkinAtMin: 20 * 60,
};
// An average stride: the distance and the energy of a step. The app uses the same numbers for the live count.
const KM_PER_STEP = 0.00075;
const KCAL_PER_STEP = 0.04;
const MAX_STEPS = 100_000; // no one walks more than this in a day: stops a wrong reading from the sensor
const MAX_STEPS_PER_SECOND = 6; // a fast runner does about 3; more than this in a walk is a wrong reading
const WALK_LIST_LIMIT = 50;
const MAX_WATER_ML = 10_000; // one person cannot drink more than this in a day: stops typing mistakes
const STREAK_LOOK_BACK_DAYS = 400;

// A person's wellness day: water, mood (and later medicines). Every query carries the userId from the login token.
//  - A day is "complete" when every goal of the day is done: the water goal and a mood. Medicines are not a goal until
//    they can be added (a later version): a goal nobody can work on must not count as done.
//  - The streak counts complete days in a row. A day that is not complete YET does not break it until the day is over.
function createWellnessService({prisma, now = () => new Date(), stepWindow = createStepWindow({redis: null})}) {
  const today = () => istDay(now());

  async function settingsOf(userId) {
    const row = await prisma.wellnessSettings.findFirst({where: {userId}});
    return Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map(key => [key, row?.[key] ?? DEFAULT_SETTINGS[key]]));
  }

  async function ensureDay(userId, day) {
    const found = await prisma.wellnessDay.findFirst({where: {userId, day}});
    if (found) {
      return found;
    }
    try {
      return await prisma.wellnessDay.create({data: {userId, day}});
    } catch (error) {
      if (error.code === 'P2002') {
        return prisma.wellnessDay.findFirst({where: {userId, day}}); // created a moment ago by another request
      }
      throw error;
    }
  }

  const goalMlOf = settings => settings.waterGoalGlasses * settings.glassMl;
  const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;
  const distanceOf = steps => round(steps * KM_PER_STEP, 2);
  const kcalOf = steps => Math.round(steps * KCAL_PER_STEP);
  const stepsOf = (count, settings) => ({
    count,
    goal: settings.stepGoal,
    percent: Math.min(100, Math.round((count / settings.stepGoal) * 100)),
    distanceKm: distanceOf(count),
    kcal: kcalOf(count),
    perStep: {km: KM_PER_STEP, kcal: KCAL_PER_STEP},
  });
  const glassesOf = (ml, settings) => Math.floor(ml / settings.glassMl);
  const isComplete = (row, settings) => Boolean(row) && row.waterMl >= goalMlOf(settings) && Boolean(row.mood);

  // Complete days in a row ending today (or yesterday while today is still open), and the best run in the window
  function streaksOf(rows, settings, todayDay) {
    const complete = new Set(rows.filter(row => isComplete(row, settings)).map(row => row.day));
    let current = 0;
    let day = complete.has(todayDay) ? todayDay : addDays(todayDay, -1);
    while (complete.has(day)) {
      current += 1;
      day = addDays(day, -1);
    }
    let best = 0;
    let run = 0;
    [...complete].sort().forEach((value, index, all) => {
      run = index > 0 && addDays(all[index - 1], 1) === value ? run + 1 : 1;
      best = Math.max(best, run);
    });
    return {current, best};
  }

  // The day maths, shared with the rewards and the reports so there is one set of rules
  const calc = {settingsOf, goalMlOf, isComplete, streaksOf, today};
  const rewards = createRewardsService({prisma, now, calc});
  const reports = createReportsService({prisma, calc, perStep: {km: KM_PER_STEP, kcal: KCAL_PER_STEP}});

  async function view(userId) {
    const day = today();
    const [settings, rows] = await Promise.all([
      settingsOf(userId),
      prisma.wellnessDay.findMany({where: {userId, day: {gte: addDays(day, -STREAK_LOOK_BACK_DAYS)}}, orderBy: {day: 'desc'}}),
    ]);
    const row = rows.find(r => r.day === day);
    const waterMl = row?.waterMl ?? 0;
    const goalMl = goalMlOf(settings);
    const mood = row?.mood ?? null;

    const goals = [
      {id: 'water', done: waterMl >= goalMl},
      {id: 'mood', done: Boolean(mood)},
    ];
    const done = goals.filter(goal => goal.done).length;

    const week = Array.from({length: 7}, (_, i) => {
      const d = addDays(day, i - 6);
      const found = rows.find(r => r.day === d);
      return {day: d, waterMl: found?.waterMl ?? 0, glasses: glassesOf(found?.waterMl ?? 0, settings), steps: found?.steps ?? 0};
    });

    const streak = streaksOf(rows, settings, day);
    const rewardsSummary = await rewards.summary(userId, streak);

    return {
      day,
      settings,
      defaults: DEFAULT_SETTINGS, // the usual values: the app marks them "(default)" and can go back to them
      water: {ml: waterMl, glasses: glassesOf(waterMl, settings), goalMl, goalGlasses: settings.waterGoalGlasses, percent: Math.min(100, Math.round((waterMl / goalMl) * 100))},
      mood,
      steps: stepsOf(row?.steps ?? 0, settings),
      goals: {items: goals, done, total: goals.length, percent: Math.round((done / goals.length) * 100), complete: done === goals.length},
      streak,
      rewards: rewardsSummary,
      week,
    };
  }

  const toWalk = walk => ({
    id: walk.id,
    startedAt: walk.startedAt.toISOString(),
    durationSec: walk.durationSec,
    steps: walk.steps,
    distanceKm: distanceOf(walk.steps),
    kcal: kcalOf(walk.steps),
  });

  return {
    rewards,
    reports,
    today: userId => view(userId),

    async addWater(userId, ml) {
      const row = await ensureDay(userId, today());
      const next = Math.max(0, Math.min(MAX_WATER_ML, row.waterMl + ml));
      if (next !== row.waterMl) {
        await prisma.wellnessDay.update({where: {id: row.id}, data: {waterMl: next}});
      }
      await rewards.award(userId);
      return view(userId);
    },

    // The phone sends the day's total steps. It only ever goes up, so a late or repeated message cannot take steps away.
    async setSteps(userId, steps) {
      const row = await ensureDay(userId, today());
      const next = Math.min(MAX_STEPS, Math.max(row.steps, steps));
      if (next !== row.steps) {
        await prisma.wellnessDay.update({where: {id: row.id}, data: {steps: next}});
      }
      await rewards.award(userId);
      return view(userId);
    },

    // The phone's steps, in small batches ("25 steps at 10:41"). Each batch is counted once, whatever number of times it is
    // sent (a retry after a bad connection is harmless), and goes to the day it was counted on, so steps counted offline
    // and sent a day later still land on the right day. Redis only gets the batches of the last 10 minutes.
    async addStepBatches(userId, batches) {
      const nowMs = now().getTime();
      batches.forEach((batch, index) => {
        const at = Date.parse(batch.recordedAt);
        if (at > nowMs + 5 * 60_000 || at < nowMs - 7 * 86_400_000) {
          throw badRequest('Some details are not valid.', [{field: `batches.${index}.recordedAt`, message: 'A batch must be from the last 7 days.'}]);
        }
      });
      const added = [];
      const days = new Set();
      let duplicates = 0;
      for (const batch of batches) {
        const recordedAt = new Date(batch.recordedAt);
        const day = istDay(recordedAt);
        try {
          await prisma.wellnessStepBatch.create({data: {userId, batchId: batch.batchId, key: `${userId}:${batch.batchId}`, steps: batch.steps, recordedAt, day}});
        } catch (error) {
          if (error.code === 'P2002') {
            duplicates += 1; // counted before
            continue;
          }
          throw error;
        }
        const row = await ensureDay(userId, day);
        await prisma.wellnessDay.update({where: {id: row.id}, data: {steps: {increment: batch.steps}}});
        days.add(day);
        added.push({batchId: batch.batchId, steps: batch.steps, recordedAtMs: recordedAt.getTime()});
      }
      for (const day of days) {
        const row = await prisma.wellnessDay.findFirst({where: {userId, day}});
        if (row.steps > MAX_STEPS) {
          await prisma.wellnessDay.update({where: {id: row.id}, data: {steps: MAX_STEPS}});
        }
      }
      await stepWindow.add(userId, added);
      await rewards.award(userId); // points are paid for today only
      return {...(await view(userId)), batches: {received: batches.length, added: added.length, duplicates}};
    },

    // The steps of the last 10 minutes from Redis: {available: false} when there is no Redis (or it is down)
    async recentSteps(userId) {
      return stepWindow.recent(userId);
    },

    // A walk recorded with Walk mode
    async addWalk(userId, {startedAt, durationSec, steps}) {
      const start = new Date(startedAt);
      const nowMs = now().getTime();
      if (start.getTime() > nowMs + 5 * 60_000 || start.getTime() < nowMs - 2 * 86_400_000) {
        throw badRequest('Some details are not valid.', [{field: 'startedAt', message: 'The walk must have started within the last 2 days.'}]);
      }
      if (steps / durationSec > MAX_STEPS_PER_SECOND) {
        throw badRequest('Some details are not valid.', [{field: 'steps', message: 'These steps are not possible in this time.'}]);
      }
      const walk = await prisma.wellnessWalk.create({data: {userId, startedAt: start, durationSec, steps}});
      return toWalk(walk);
    },

    async listWalks(userId, days) {
      const since = new Date(now().getTime() - days * 86_400_000);
      const rows = await prisma.wellnessWalk.findMany({where: {userId, startedAt: {gte: since}}, orderBy: {startedAt: 'desc'}, take: WALK_LIST_LIMIT});
      return {days, items: rows.map(toWalk)};
    },

    async setMood(userId, mood) {
      const row = await ensureDay(userId, today());
      await prisma.wellnessDay.update({where: {id: row.id}, data: {mood}});
      await rewards.award(userId);
      return view(userId);
    },

    // The days that have something in them, newest first (7, 30 or 90 days back)
    async history(userId, days) {
      const day = today();
      const [settings, rows] = await Promise.all([
        settingsOf(userId),
        prisma.wellnessDay.findMany({where: {userId, day: {gte: addDays(day, -(days - 1))}}, orderBy: {day: 'desc'}}),
      ]);
      return {
        days,
        items: rows
          .filter(row => row.waterMl > 0 || row.steps > 0 || row.mood)
          .map(row => ({
            day: row.day,
            waterMl: row.waterMl,
            glasses: glassesOf(row.waterMl, settings),
            steps: row.steps,
            goalGlasses: settings.waterGoalGlasses,
            goalMl: goalMlOf(settings),
            mood: row.mood,
            complete: isComplete(row, settings),
          })),
      };
    },

    async getSettings(userId) {
      return settingsOf(userId);
    },

    async updateSettings(userId, changes) {
      // the water reminders must start before they end, whatever combination of old and new values it is
      const merged = {...(await settingsOf(userId)), ...changes};
      if (merged.waterFromMin >= merged.waterUntilMin) {
        throw badRequest('Some details are not valid.', [{field: 'waterUntilMin', message: 'The water reminders must end after they start.'}]);
      }
      const existing = await prisma.wellnessSettings.findFirst({where: {userId}});
      if (existing) {
        await prisma.wellnessSettings.update({where: {userId}, data: changes});
      } else {
        try {
          await prisma.wellnessSettings.create({data: {userId, ...changes}});
        } catch (error) {
          if (error.code !== 'P2002') {
            throw error;
          }
          await prisma.wellnessSettings.update({where: {userId}, data: changes}); // created a moment ago
        }
      }
      await rewards.award(userId);
      return view(userId);
    },
  };
}

module.exports = {createWellnessService, DEFAULT_SETTINGS, MAX_WATER_ML, MAX_STEPS, KM_PER_STEP, KCAL_PER_STEP};
