// The usual wellness settings, as the backend sends them (times are minutes after midnight). For the tests.
export const SETTINGS = {
  waterGoalGlasses: 8,
  glassMl: 250,
  stepGoal: 6000,
  waterReminderOn: true,
  waterEveryMin: 120,
  waterFromMin: 540,
  waterUntilMin: 1260,
  medMorningMin: 480,
  medAfternoonMin: 780,
  medEveningMin: 1080,
  medNightMin: 1260,
  checkinOn: true,
  checkinAtMin: 1200,
};

// What the backend sends for a person with no points yet (the first four badges)
export const REWARDS_EMPTY = {
  balance: 0,
  rupees: 0,
  badgesEarned: 0,
  badgesTotal: 11,
  badges: [
    {id: 'first_checkin', name: 'First check-in', icon: 'check-circle', target: 1, progress: 0, earned: false, earnedOn: null},
    {id: 'streak3', name: '3-day streak', icon: 'fire', target: 3, progress: 0, earned: false, earnedOn: null},
    {id: 'streak7', name: 'Week warrior', icon: 'fire', target: 7, progress: 0, earned: false, earnedOn: null},
    {id: 'streak14', name: 'Fortnight focus', icon: 'fire', target: 14, progress: 0, earned: false, earnedOn: null},
  ],
};
