import {
  EMAIL_REGEX,
  MOBILE_REGEX,
  NAME_REGEX,
  PASSWORD_REGEX,
  USERNAME_REGEX,
  validateLogin,
  validateSignUp,
} from '../src/utils/validators';

const GOOD_SIGN_UP = {name: 'Asha Verma', email: 'asha@example.com', password: 'Herbs1234', mobile: '9876543210'};

describe('regexes', () => {
  test('email', () => {
    for (const ok of ['a@b.co', 'asha.verma+shop@mail.example.in', 'x_y-z@sub-domain.example.com']) {
      expect(EMAIL_REGEX.test(ok)).toBe(true);
    }
    for (const bad of ['', 'asha', 'asha@', '@example.com', 'a@b', 'a@b.c', 'a b@example.com', 'a@@example.com', 'a@exa mple.com', 'a@example..com']) {
      expect(EMAIL_REGEX.test(bad)).toBe(false);
    }
  });

  test('indian mobile number', () => {
    expect(MOBILE_REGEX.test('9876543210')).toBe(true);
    expect(MOBILE_REGEX.test('6000000000')).toBe(true);
    for (const bad of ['5876543210', '987654321', '98765432100', '+919876543210', '98765 43210', 'abcdefghij', '']) {
      expect(MOBILE_REGEX.test(bad)).toBe(false);
    }
  });

  test('name', () => {
    for (const ok of ['Asha', 'Asha Verma', "D'Souza", 'Mary-Ann', 'आशा वर्मा', 'عائشہ']) {
      expect(NAME_REGEX.test(ok)).toBe(true);
    }
    for (const bad of ['A', '', 'Asha123', '<script>', ' Asha', '-Asha', 'a'.repeat(61)]) {
      expect(NAME_REGEX.test(bad)).toBe(false);
    }
  });

  test('username', () => {
    expect(USERNAME_REGEX.test('asha_verma.1')).toBe(true);
    for (const bad of ['ab', '1asha', 'asha verma', 'asha@x', 'a'.repeat(31)]) {
      expect(USERNAME_REGEX.test(bad)).toBe(false);
    }
  });

  test('password needs a letter, a number, 8-64 characters and no spaces', () => {
    expect(PASSWORD_REGEX.test('Herbs1234')).toBe(true);
    expect(PASSWORD_REGEX.test('p@ssw0rd!')).toBe(true);
    for (const bad of ['short1', 'onlyletters', '123456789', 'has space 1a', 'a1'.repeat(33)]) {
      expect(PASSWORD_REGEX.test(bad)).toBe(false);
    }
  });
});

describe('validateLogin', () => {
  test('accepts an email, a mobile number or a username', () => {
    for (const username of ['asha@example.com', '9876543210', 'asha_verma']) {
      expect(validateLogin({username, password: 'x'})).toEqual({});
    }
  });

  test('rejects empty and malformed input', () => {
    expect(validateLogin({username: '', password: ''})).toEqual({
      username: expect.stringContaining('enter your'),
      password: expect.stringContaining('enter your password'),
    });
    expect(validateLogin({username: 'not valid!', password: 'x'}).username).toMatch(/valid/);
    expect(validateLogin({username: 'asha', password: 'x'.repeat(65)}).password).toMatch(/at most 64/);
  });

  test('trims the username before checking', () => {
    expect(validateLogin({username: '  asha@example.com ', password: 'x'})).toEqual({});
  });
});

describe('validateSignUp', () => {
  test('a good form has no errors', () => {
    expect(validateSignUp(GOOD_SIGN_UP)).toEqual({});
  });

  test('reports every bad field', () => {
    const errors = validateSignUp({name: '1', email: 'nope', password: 'weak', mobile: '123'});
    expect(Object.keys(errors).sort()).toEqual(['email', 'mobile', 'name', 'password']);
  });

  test('checks one field at a time', () => {
    expect(Object.keys(validateSignUp({...GOOD_SIGN_UP, mobile: '1234567890'}))).toEqual(['mobile']);
    expect(Object.keys(validateSignUp({...GOOD_SIGN_UP, password: 'allletters'}))).toEqual(['password']);
  });

  test('long input is rejected quickly (no catastrophic backtracking)', () => {
    const started = Date.now();
    validateSignUp({name: 'a'.repeat(5000), email: `${'a'.repeat(5000)}@${'b.'.repeat(2500)}`, password: 'a'.repeat(5000), mobile: '9'.repeat(5000)});
    expect(Date.now() - started).toBeLessThan(500);
  });
});
