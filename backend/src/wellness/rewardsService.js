const {conflict} = require('../common/errors');
const {addDays, weekStartOf} = require('./dates');
const {BADGES, CHALLENGES, EARN_RULES, MIN_STEP_GOAL, MIN_WATER_GOAL_ML, POINTS, POINTS_PER_RUPEE, REASON_LABELS, REDEEM_UNIT} = require('./rewardsRules');

const HISTORY_LIMIT = 50;
const WALLET_LIMIT = 20;
const LOOK_BACK_DAYS = 400;

// Points, badges and challenges. Every point is one row in wellness_points, and a row is written once: its `refKey`
// ("<user>:water:2026-11-24") is unique, so the same good thing can never be paid twice, however often it is checked.
// Points are never taken back when water is taken back, but they cannot be earned again either.
// `calc` gives the wellness day maths of wellnessService (settings, goals, streaks), so there is one set of rules.
function createRewardsService({prisma, now = () => new Date(), calc}) {
  const {settingsOf, goalMlOf, isComplete, streaksOf, today} = calc;

  const loadRows = (userId, day) =>
    prisma.wellnessDay.findMany({where: {userId, day: {gte: addDays(day, -LOOK_BACK_DAYS)}}, orderBy: {day: 'desc'}});

  // Writes a point row once. Resolves true when it was new.
  async function give(userId, reason, key, points, {day = null, ref = null} = {}) {
    try {
      await prisma.wellnessPoint.create({data: {userId, points, reason, ref, day, refKey: `${userId}:${key}`}});
      return true;
    } catch (error) {
      if (error.code === 'P2002') {
        return false; // paid before
      }
      throw error;
    }
  }

  const countOf = (userId, reason, range) =>
    prisma.wellnessPoint.count({where: {userId, reason, ...(range ? {day: {gte: range.from, lte: range.to}} : {})}});

  async function balanceOf(userId) {
    const sum = await prisma.wellnessPoint.aggregate({where: {userId}, _sum: {points: true}});
    return sum._sum.points ?? 0;
  }

  async function earnedEver(userId) {
    const sum = await prisma.wellnessPoint.aggregate({where: {userId, points: {gt: 0}}, _sum: {points: true}});
    return sum._sum.points ?? 0;
  }

  // What each badge counts right now, and which badges the person has
  async function badgeState(userId, streak) {
    const [complete, water, steps, points, earned] = await Promise.all([
      countOf(userId, 'complete'),
      countOf(userId, 'water'),
      countOf(userId, 'steps'),
      earnedEver(userId),
      prisma.wellnessPoint.findMany({where: {userId, reason: 'badge'}, orderBy: {id: 'asc'}}),
    ]);
    const measures = {complete, water, steps, points, streak: Math.max(streak.current, streak.best)};
    const earnedBy = new Map(earned.map(row => [row.ref, row.day]));
    const badges = BADGES.map(badge => ({
      id: badge.id,
      name: badge.name,
      icon: badge.icon,
      target: badge.target,
      progress: Math.min(measures[badge.measure], badge.target),
      earned: earnedBy.has(badge.id),
      earnedOn: earnedBy.get(badge.id) ?? null,
    }));
    return {measures, badges, earnedBy};
  }

  const streakOf = async (userId, day) => {
    const [settings, rows] = await Promise.all([settingsOf(userId), loadRows(userId, day)]);
    return streaksOf(rows, settings, day);
  };

  async function challengesOf(userId, day) {
    const from = weekStartOf(day);
    const range = {from, to: addDays(from, 6)};
    return Promise.all(
      CHALLENGES.map(async challenge => {
        const progress = await countOf(userId, challenge.reason, range);
        return {id: challenge.id, title: challenge.title, target: challenge.target, bonus: POINTS.challenge, progress: Math.min(progress, challenge.target), done: progress >= challenge.target, weekStart: from};
      }),
    );
  }

  const rupeesOf = points => Math.floor(points / POINTS_PER_RUPEE);

  const service = {
    // Pays everything that is due for today. Called after every change of the day's water, steps, mood or goals.
    async award(userId) {
      const day = today();
      const [settings, rows] = await Promise.all([settingsOf(userId), loadRows(userId, day)]);
      const row = rows.find(r => r.day === day);
      if (!row) {
        return;
      }
      const waterGoalOk = goalMlOf(settings) >= MIN_WATER_GOAL_ML;
      const stepGoalOk = settings.stepGoal >= MIN_STEP_GOAL;
      if (waterGoalOk && row.waterMl >= goalMlOf(settings)) {
        await give(userId, 'water', `water:${day}`, POINTS.water, {day});
      }
      if (stepGoalOk && row.steps >= settings.stepGoal) {
        await give(userId, 'steps', `steps:${day}`, POINTS.steps, {day});
      }
      const streak = streaksOf(rows, settings, day);
      if (waterGoalOk && isComplete(row, settings)) {
        await give(userId, 'complete', `complete:${day}`, POINTS.complete, {day});
        if (streak.current >= 7 && streak.current % 7 === 0) {
          // the key holds where this run began, so a second run of 7 after a break is paid too
          await give(userId, 'streak', `streak:${addDays(day, -(streak.current - 1))}:${streak.current}`, POINTS.streak, {day, ref: String(streak.current)});
        }
      }
      for (const challenge of await challengesOf(userId, day)) {
        if (challenge.done) {
          await give(userId, 'challenge', `challenge:${challenge.id}:${challenge.weekStart}`, POINTS.challenge, {day, ref: challenge.id});
        }
      }
      // a badge pays points, which can complete the "Point collector" badge: look twice
      for (let pass = 0; pass < 2; pass += 1) {
        const {badges} = await badgeState(userId, streak);
        for (const badge of badges.filter(b => !b.earned && b.progress >= b.target)) {
          await give(userId, 'badge', `badge:${badge.id}`, POINTS.badge, {day, ref: badge.id});
        }
      }
    },

    // For the Home screen: the points and the first four badges
    async summary(userId, streak) {
      const [balance, {badges}] = await Promise.all([balanceOf(userId), badgeState(userId, streak)]);
      return {balance, rupees: rupeesOf(balance), badgesEarned: badges.filter(b => b.earned).length, badgesTotal: badges.length, badges: badges.slice(0, 4)};
    },

    // Everything of the Rewards tab
    async full(userId) {
      const day = today();
      const streak = await streakOf(userId, day);
      const [balance, {badges}, challenges, history, wallet] = await Promise.all([
        balanceOf(userId),
        badgeState(userId, streak),
        challengesOf(userId, day),
        prisma.wellnessPoint.findMany({where: {userId}, orderBy: {id: 'desc'}, take: HISTORY_LIMIT}),
        prisma.wellnessPoint.findMany({where: {userId, reason: 'redeem'}, orderBy: {id: 'desc'}, take: WALLET_LIMIT}),
      ]);
      const names = Object.fromEntries([...BADGES.map(b => [`badge:${b.id}`, `Badge: ${b.name}`]), ...CHALLENGES.map(c => [`challenge:${c.id}`, `Challenge: ${c.title}`])]);
      const labelOf = row => (row.reason === 'badge' || row.reason === 'challenge' ? names[`${row.reason}:${row.ref}`] : REASON_LABELS[row.reason]) ?? row.reason;
      const redeemable = Math.floor(balance / REDEEM_UNIT) * REDEEM_UNIT;
      return {
        balance,
        rupees: rupeesOf(balance),
        pointsPerRupee: POINTS_PER_RUPEE,
        redeem: {unit: REDEEM_UNIT, unitRupees: rupeesOf(REDEEM_UNIT), points: redeemable, rupees: rupeesOf(redeemable), canRedeem: redeemable > 0, pointsToGo: Math.max(0, REDEEM_UNIT - balance)},
        earn: EARN_RULES,
        challenges,
        badges,
        history: history.map(row => ({id: row.id, points: row.points, label: labelOf(row), at: row.createdAt.toISOString()})),
        wallet: wallet.map(row => ({id: row.id, points: -row.points, rupees: Number(row.ref), at: row.createdAt.toISOString()})),
      };
    },

    // Turns points into wallet money (the discount credits). `points` is a multiple of REDEEM_UNIT.
    async redeem(userId, points) {
      const rupees = rupeesOf(points);
      await prisma.$transaction(async tx => {
        // Touching the user's row first makes two redeems of the same person wait for each other: the balance below
        // is then checked after the first one is done, so the same points are never spent twice.
        await tx.user.update({where: {id: userId}, data: {credits: {increment: 0}}});
        const sum = await tx.wellnessPoint.aggregate({where: {userId}, _sum: {points: true}});
        if ((sum._sum.points ?? 0) < points) {
          throw conflict('You do not have enough points.');
        }
        await tx.wellnessPoint.create({
          data: {userId, points: -points, reason: 'redeem', ref: String(rupees), day: today(), refKey: `${userId}:redeem:${now().getTime()}:${Math.random().toString(36).slice(2, 10)}`},
        });
        const left = await tx.wellnessPoint.aggregate({where: {userId}, _sum: {points: true}});
        if ((left._sum.points ?? 0) < 0) {
          throw conflict('You do not have enough points.'); // undone: nothing was added
        }
        await tx.user.update({where: {id: userId}, data: {credits: {increment: rupees}}});
        await tx.creditEntry.create({data: {userId, delta: rupees, reason: 'Wellness points'}});
      });
      const account = await prisma.user.findUnique({where: {id: userId}});
      return {...(await service.full(userId)), walletCredits: account?.credits ?? 0, added: rupees};
    },
  };
  return service;
}

module.exports = {createRewardsService};
