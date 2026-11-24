// The rules of the wellness rewards. Change a number here and the whole app follows (the app shows what the server sends).

// Points for each good thing (once a day each, once per badge, once per challenge a week)
const POINTS = {
  water: 10, // the water goal reached
  steps: 10, // the step goal reached
  complete: 5, // the whole day complete (water goal and a mood)
  streak: 50, // every 7 days in a row
  badge: 25, // each badge
  challenge: 30, // each weekly challenge
};

// 10 points are Re 1 of wallet money (the discount credits of consultations: 1 credit = Re 1).
// Points are turned into money in steps of REDEEM_UNIT points.
const POINTS_PER_RUPEE = 10;
const REDEEM_UNIT = 500;

// Points are worth money, so a goal that is too easy earns nothing: the water goal must be at least this much ...
const MIN_WATER_GOAL_ML = 1500;
// ... and the step goal at least this many steps
const MIN_STEP_GOAL = 3000;

// How each kind of point is shown in the history
const REASON_LABELS = {
  water: 'Water goal reached',
  steps: 'Step goal reached',
  complete: 'Daily check-in complete',
  streak: '7 days in a row',
  redeem: 'Added to wallet',
};

// What each badge counts. measure: complete = complete days, water = days with the water goal, steps = days with the
// step goal, streak = the longest run of complete days, points = all points ever earned.
// (The medicine badges come when medicines do.)
const BADGES = [
  {id: 'first_checkin', name: 'First check-in', icon: 'check-circle', measure: 'complete', target: 1},
  {id: 'streak3', name: '3-day streak', icon: 'fire', measure: 'streak', target: 3},
  {id: 'streak7', name: 'Week warrior', icon: 'fire', measure: 'streak', target: 7},
  {id: 'streak14', name: 'Fortnight focus', icon: 'fire', measure: 'streak', target: 14},
  {id: 'streak30', name: '30 day champion', icon: 'trophy', measure: 'streak', target: 30},
  {id: 'streak100', name: '100 day legend', icon: 'trophy', measure: 'streak', target: 100},
  {id: 'water7', name: 'Water warrior', icon: 'water', measure: 'water', target: 7},
  {id: 'water30', name: 'Hydration master', icon: 'water', measure: 'water', target: 30},
  {id: 'first_steps', name: 'First steps', icon: 'shoe-print', measure: 'steps', target: 1},
  {id: 'walking_star', name: 'Walking star', icon: 'shoe-print', measure: 'steps', target: 10},
  {id: 'point_collector', name: 'Point collector', icon: 'star', measure: 'points', target: 1000},
];

// Challenges of the week (Monday to Sunday): count the days of this week that earned `reason` points
const CHALLENGES = [
  {id: 'water5', title: 'Reach your water goal on 5 days', reason: 'water', target: 5},
  {id: 'steps5', title: 'Reach your step goal on 5 days', reason: 'steps', target: 5},
  {id: 'checkins7', title: 'Complete all 7 check-ins this week', reason: 'complete', target: 7},
];

// The list shown as "How to earn points"
const EARN_RULES = [
  {id: 'water', label: 'Reach your water goal', points: POINTS.water},
  {id: 'steps', label: 'Reach your step goal', points: POINTS.steps},
  {id: 'complete', label: 'Complete the day', points: POINTS.complete},
  {id: 'streak', label: 'Every 7 days in a row', points: POINTS.streak},
  {id: 'badge', label: 'Each badge', points: POINTS.badge},
  {id: 'challenge', label: 'Each weekly challenge', points: POINTS.challenge},
];

module.exports = {POINTS, POINTS_PER_RUPEE, REDEEM_UNIT, MIN_WATER_GOAL_ML, MIN_STEP_GOAL, REASON_LABELS, BADGES, CHALLENGES, EARN_RULES};
