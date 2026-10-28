import {formatMobile, normalizeMobile} from '../src/utils/phone';

test('turns any way of writing an Indian mobile number into 10 digits', () => {
  expect(normalizeMobile('9876543210')).toBe('9876543210');
  expect(normalizeMobile('+91 98765 43210')).toBe('9876543210');
  expect(normalizeMobile('+91-98765-43210')).toBe('9876543210');
  expect(normalizeMobile('919876543210')).toBe('9876543210');
  expect(normalizeMobile('098765 43210')).toBe('9876543210');
  expect(normalizeMobile('(98765) 43210')).toBe('9876543210');
});

test('rejects numbers that are not Indian mobile numbers', () => {
  expect(normalizeMobile('')).toBe('');
  expect(normalizeMobile(null)).toBe('');
  expect(normalizeMobile('12345')).toBe('');
  expect(normalizeMobile('5876543210')).toBe(''); // mobile numbers start with 6-9
  expect(normalizeMobile('98765432109')).toBe(''); // 11 digits not starting with 0
  expect(normalizeMobile('+44 7911 123456')).toBe('');
});

test('shows a number the way people write it', () => {
  expect(formatMobile('9876543210')).toBe('+91 98765 43210');
  expect(formatMobile('+91 98765-43210')).toBe('+91 98765 43210');
  expect(formatMobile('Asha')).toBe('Asha');
});
