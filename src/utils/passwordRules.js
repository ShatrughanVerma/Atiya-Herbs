// The same rules as the backend (backend/src/auth/passwordService.js), checked on the phone first so a person
// finds out at once. The server also refuses a list of very common passwords and tells us in its own words.
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const PASSWORD_HINT = `At least ${PASSWORD_MIN} characters, with a letter and a number`;

// '' when the password is fine, else what to tell the person
export function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) {
    return `Password must be at least ${PASSWORD_MIN} characters.`;
  }
  if (password.length > PASSWORD_MAX) {
    return `Password must be at most ${PASSWORD_MAX} characters.`;
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return 'Password must contain at least one letter and one number.';
  }
  return '';
}
