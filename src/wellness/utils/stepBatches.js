// The phone sends its steps to the server in small batches ("25 steps counted at 10:41"), not as one number.
//   state = { open: { steps, since } | null, queue: [{ batchId, steps, recordedAt }] }
//   - `open` is the batch being filled right now,
//   - `queue` holds the closed batches that the server has not confirmed yet. It is kept on the phone, so a batch counted
//     without internet (or just before the app was closed) is sent later, even a day later.
// A batch has its own id, and the server counts an id only once, so sending a batch twice is harmless.

export const BATCH_EVERY_STEPS = 20; // a batch is closed after this many steps ...
export const BATCH_EVERY_MS = 60000; // ... or after this long, whichever comes first
export const MAX_PER_REQUEST = 100; // the server takes at most this many batches in one request
export const MAX_AGE_MS = 6.9 * 86400000; // the server refuses a batch older than 7 days: do not even try

export const emptyState = () => ({ open: null, queue: [] });

// "k2x9a1-0f3z8q2a": the time and some random letters (8 to 40 letters, digits, - or _, as the server wants)
export const newBatchId = (now = Date.now(), random = Math.random) =>
  `${now.toString(36)}-${Math.floor(random() * 36 ** 8)
    .toString(36)
    .padStart(8, '0')}`;

// Steps counted just now go into the open batch
export function addSteps(state, steps, now = Date.now()) {
  if (steps <= 0) {
    return state;
  }
  const open = state.open ?? { steps: 0, since: now };
  return { ...state, open: { ...open, steps: open.steps + steps } };
}

// Is the open batch ready to be closed?
export const isDue = (state, now = Date.now()) =>
  !!state.open &&
  state.open.steps > 0 &&
  (state.open.steps >= BATCH_EVERY_STEPS || now - state.open.since >= BATCH_EVERY_MS);

// Moves the open batch into the queue. `recordedAt` is when its steps were counted (an ISO time).
export function closeOpen(state, recordedAt, batchId = newBatchId()) {
  if (!state.open || state.open.steps <= 0) {
    return { ...state, open: null };
  }
  return {
    open: null,
    queue: [...state.queue, { batchId, steps: state.open.steps, recordedAt }],
  };
}

// The batches to send now: the oldest first, never too many, never too old
export const nextToSend = (state, now = Date.now()) =>
  state.queue
    .filter(batch => now - Date.parse(batch.recordedAt) < MAX_AGE_MS)
    .slice(0, MAX_PER_REQUEST);

// The server has them: take them out of the queue (and any batch that is too old to ever be accepted)
export const confirmed = (state, batchIds, now = Date.now()) => ({
  ...state,
  queue: state.queue.filter(
    batch =>
      !batchIds.includes(batch.batchId) &&
      now - Date.parse(batch.recordedAt) < MAX_AGE_MS,
  ),
});

// 11:59 PM Indian time of a day: where the steps of a day that has just ended are put
export const endOfDayIso = day => new Date(`${day}T23:59:00+05:30`).toISOString();
