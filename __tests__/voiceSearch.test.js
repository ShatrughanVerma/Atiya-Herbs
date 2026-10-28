import {matchProduct} from '../src/utils/voiceSearch';

const idOf = phrases => matchProduct(phrases)?.id ?? null;

test('matches a spoken product name', () => {
  expect(idOf(['pain relief oil'])).toBe('pain-relief-oil');
  expect(idOf(['show me Kalonji Shampoo please'])).toBe('kalonji-shampoo');
});

test('ignores case, punctuation and plurals', () => {
  expect(idOf(['JOINT FORTE!'])).toBe('joints-forte');
});

test('prefers the longer, more specific name', () => {
  expect(idOf(['gond siyah capsules'])).toBe('gond-siyah-capsules');
});

test('understands misheard single-letter names', () => {
  expect(idOf(['tea care'])).toBe('t-care');
  expect(idOf(['H care hair oil'])).toBe('h-care-hair-oil');
});

test('uses a later guess when the first one names no product', () => {
  expect(idOf(['karela for tea', 'karela forte'])).toBe('karela-forte');
});

test('returns null when no product was clearly named', () => {
  expect(idOf(['something for my knees'])).toBeNull();
  expect(idOf(['kalonji'])).toBeNull(); // shampoo or face wash: let search show both
  expect(idOf([])).toBeNull();
});
