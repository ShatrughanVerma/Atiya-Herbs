// Input checks for the login and sign-up forms. They catch typing mistakes on the phone only;
// the server must check everything again.

// 1-64 characters before the @, then dot-separated labels and a letters-only ending (.com, .in)
export const EMAIL_REGEX = /^[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9-]{1,63}\.)+[A-Za-z]{2,24}$/;
// Indian mobile number: 10 digits starting with 6-9
export const MOBILE_REGEX = /^[6-9][0-9]{9}$/;
// Letters (English, Hindi, Urdu), spaces and . ' - only; 2-60 characters, must start with a letter
export const NAME_REGEX = /^[A-Za-zऀ-ॿ؀-ۿ][A-Za-zऀ-ॿ؀-ۿ .'-]{1,59}$/;
// Starts with a letter, then letters, digits, dot or underscore; 3-30 characters
export const USERNAME_REGEX = /^[A-Za-z][A-Za-z0-9._]{2,29}$/;
// 8-64 characters, no spaces, at least one letter and one digit
export const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*[0-9])\S{8,64}$/;

export const PASSWORD_MAX = 64;

export const isEmail = value => EMAIL_REGEX.test(String(value).trim());
export const isMobile = value => MOBILE_REGEX.test(String(value));

export function validateLogin({username, password}) {
  const errors = {};
  const id = String(username).trim();
  if (!id) {
    errors.username = 'Please enter your email, mobile number or username';
  } else if (!isEmail(id) && !MOBILE_REGEX.test(id) && !USERNAME_REGEX.test(id)) {
    errors.username = 'Enter a valid email, 10-digit mobile number or username';
  }
  if (!password) {
    errors.password = 'Please enter your password';
  } else if (password.length > PASSWORD_MAX) {
    errors.password = `Password can be at most ${PASSWORD_MAX} characters`;
  }
  return errors;
}

export function validateSignUp({name, email, password, mobile}) {
  const errors = {};
  if (!NAME_REGEX.test(name.trim())) {
    errors.name = 'Please enter your full name (letters only, 2-60 characters)';
  }
  if (!isEmail(email)) {
    errors.email = 'Please enter a valid email';
  }
  if (!PASSWORD_REGEX.test(password)) {
    errors.password = 'Use 8-64 characters with at least one letter and one number, no spaces';
  }
  if (!MOBILE_REGEX.test(mobile)) {
    errors.mobile = 'Please enter a valid 10-digit mobile number';
  }
  return errors;
}
