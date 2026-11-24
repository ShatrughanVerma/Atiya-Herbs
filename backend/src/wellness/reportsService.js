const {addDays, addMonths, daysBetween, monthEndOf, monthName, monthStartOf, shortDay, weekStartOf} = require('./dates');

const DAILY_PERIODS = 14;
const WEEKLY_PERIODS = 8;
const MONTHLY_PERIODS = 6;

const round = (value, digits = 0) => Math.round(value * 10 ** digits) / 10 ** digits;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Daily, weekly and monthly reports from the days that were saved. A day without a row counts as nothing done, so a
// week with 2 days gone is measured over 2 days, not 7. The goals are the person's goals now.
//   `calc` gives the wellness maths of wellnessService (settings, goals, "complete day").
function createReportsService({prisma, calc, perStep}) {
  const {settingsOf, goalMlOf, isComplete, today} = calc;

  // One period [from, to] looked at on `day`: days that are still to come are not counted
  function periodOf({label, from, to}, rows, settings, day) {
    const last = to < day ? to : day;
    const elapsed = Math.max(1, daysBetween(from, last) + 1);
    const mine = rows.filter(row => row.day >= from && row.day <= last);
    const goalMl = goalMlOf(settings);
    const waterPercents = mine.map(row => Math.min(100, (row.waterMl / goalMl) * 100));
    const totalMl = mine.reduce((sum, row) => sum + row.waterMl, 0);
    const totalSteps = mine.reduce((sum, row) => sum + row.steps, 0);
    const moods = {great: 0, good: 0, okay: 0, low: 0};
    mine.forEach(row => {
      if (row.mood) {
        moods[row.mood] += 1;
      }
    });
    return {
      label,
      from,
      to,
      days: elapsed, // the days this period is measured over
      waterPercent: round(waterPercents.reduce((sum, value) => sum + value, 0) / elapsed),
      glassesPerDay: round(totalMl / settings.glassMl / elapsed, 1),
      stepsPerDay: round(totalSteps / elapsed),
      totalSteps,
      distanceKm: round(totalSteps * perStep.km, 1),
      kcal: Math.round(totalSteps * perStep.kcal),
      completeDays: mine.filter(row => isComplete(row, settings)).length,
      moods,
      medicinePercent: null, // medicines come later
    };
  }

  return {
    async report(userId, range) {
      const day = today();
      const periods = [];
      if (range === 'daily') {
        for (let i = 0; i < DAILY_PERIODS; i += 1) {
          const d = addDays(day, -i);
          const [y, m, dd] = d.split('-').map(Number);
          periods.push({label: `${WEEKDAYS[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]}, ${shortDay(d)}`, from: d, to: d});
        }
      } else if (range === 'monthly') {
        for (let i = 0; i < MONTHLY_PERIODS; i += 1) {
          const start = addMonths(monthStartOf(day), -i);
          periods.push({label: monthName(start), from: start, to: monthEndOf(start)});
        }
      } else {
        const thisWeek = weekStartOf(day);
        for (let i = 0; i < WEEKLY_PERIODS; i += 1) {
          const start = addDays(thisWeek, -7 * i);
          const end = addDays(start, 6);
          periods.push({label: `${shortDay(start)} – ${shortDay(end)}`, from: start, to: end});
        }
      }
      const oldest = periods[periods.length - 1].from;
      const [settings, rows] = await Promise.all([
        settingsOf(userId),
        prisma.wellnessDay.findMany({where: {userId, day: {gte: oldest}}, orderBy: {day: 'desc'}}),
      ]);
      const items = periods.map(period => periodOf(period, rows, settings, day));
      return {range, day, goals: {waterGlasses: settings.waterGoalGlasses, steps: settings.stepGoal}, summary: items[0], periods: items};
    },
  };
}

module.exports = {createReportsService};
