// The step sensor gives a running total since the phone was last restarted. The steps of TODAY are what it counted since
// the last reading we took, added up day by day.
//   state = { day: '2026-11-24', steps: 2300, lastCounter: 51234 }   (null before the first reading)

// Indian calendar day on this phone (the backend counts days the same way)
export const todayIst = (now = Date.now()) =>
  new Date(now + 5.5 * 3600000).toISOString().slice(0, 10);

// Adds a new sensor reading to the state.
//  - A new day starts again from 0 (the steps between the last reading and midnight cannot be told apart).
//  - A reading lower than the last one means the phone was restarted: the sensor began again from 0.
export function applyReading(state, counter, day) {
  if (!state || state.day !== day) {
    return { day, steps: 0, lastCounter: counter };
  }
  const delta =
    counter >= state.lastCounter ? counter - state.lastCounter : counter;
  return { day, steps: state.steps + delta, lastCounter: counter };
}

// Distance and energy of a number of steps; `perStep` comes from the backend so both sides use the same numbers
export const DEFAULT_PER_STEP = { km: 0.00075, kcal: 0.04 };
export const distanceKm = (steps, perStep = DEFAULT_PER_STEP) =>
  Math.round(steps * perStep.km * 100) / 100;
export const kcalOf = (steps, perStep = DEFAULT_PER_STEP) =>
  Math.round(steps * perStep.kcal);

// 1245 -> "20:45", 3700 -> "1:01:40"
export const clock = totalSeconds => {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
};

// Minutes for one km, e.g. "12:30"; "--" until there is a distance
export const pace = (durationSec, km) =>
  km > 0 ? clock(durationSec / km) : '--';
