// Why a number could not be rung into the meeting (or the call) -> what we tell the user
export const ADD_PERSON_ERRORS = {
  'invalid-number': 'Enter a valid 10-digit mobile number.',
  self: 'That is your own number.',
  offline:
    'They are not using Atiya Herbs right now. They can be added when the app is open on their phone.',
  busy: 'They are on another call or meeting.',
  'already-in': 'They are already in the meeting.',
  'already-invited': 'They are already being rung.',
  removed: 'The host removed them from this meeting.',
  locked: 'The meeting is locked. Only the host can add people.',
  full: 'The meeting is full.',
  'not-active': 'The call is not connected.',
  'not-configured': 'Group calls are not set up on the server yet.',
  'in-meeting': 'You are already in a meeting.',
  'slow-down': 'You are adding people too fast. Wait a moment.',
  timeout: 'The server did not answer. Check your internet and try again.',
  failed: 'Something went wrong. Please try again.',
};
