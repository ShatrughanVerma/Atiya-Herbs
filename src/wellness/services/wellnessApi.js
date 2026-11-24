import { authFetch } from '../../services/session';

// The health wellness endpoints of the backend (backend/src/wellness). All of them need a login.

// Everything the Home screen shows: today's water, steps, mood, goals, streak and the last 7 days
export const fetchToday = () => authFetch('/wellness/today');

// ml is + for a drink and - for taking one back
export const addWaterMl = ml =>
  authFetch('/wellness/water', { method: 'POST', body: { ml } });

// mood: 'great' | 'good' | 'okay' | 'low', or null to clear it
export const saveMood = mood =>
  authFetch('/wellness/mood', { method: 'PUT', body: { mood } });

// Steps counted by the phone, in small batches: [{ batchId, steps, recordedAt (ISO time) }]. A batch the server has
// seen before is not counted again. -> today (and `batches`: how many were new and how many were repeats)
export const addStepBatches = batches =>
  authFetch('/wellness/steps/batches', { method: 'POST', body: { batches } });

// The steps of the last 10 minutes (from Redis): { available, steps, batches, perMinute: [10 numbers, oldest first] }
export const fetchRecentSteps = () => authFetch('/wellness/steps/recent');

// A finished walk: { startedAt (ISO time), durationSec, steps }
export const addWalk = walk =>
  authFetch('/wellness/walks', { method: 'POST', body: walk });

// days: 7, 30 or 90
export const fetchWalks = days => authFetch(`/wellness/walks?days=${days}`);
export const fetchHistory = days =>
  authFetch(`/wellness/history?days=${days}`);

// The Rewards tab: points, badges, challenges, history
export const fetchRewards = () => authFetch('/wellness/rewards');

// Turns points into wallet money: points is a multiple of 500 (500 points = Rs 50)
export const redeemPoints = points =>
  authFetch('/wellness/rewards/redeem', { method: 'POST', body: { points } });

// range: 'daily' | 'weekly' | 'monthly'
export const fetchReport = range => authFetch(`/wellness/reports?range=${range}`);

// { waterGoalGlasses?, glassMl?, stepGoal? }
export const saveSettings = changes =>
  authFetch('/wellness/settings', { method: 'PUT', body: changes });
