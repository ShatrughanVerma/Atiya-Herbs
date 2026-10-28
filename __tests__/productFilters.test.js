import {PRODUCTS} from '../src/data/catalog';
import {DEFAULT_FILTERS, applyFilters, countActiveFilters} from '../src/utils/productFilters';

const run = patch => applyFilters(PRODUCTS, {...DEFAULT_FILTERS, ...patch});

test('no filters returns every product, most popular first', () => {
  const list = run({});
  expect(list).toHaveLength(PRODUCTS.length);
  expect(list[0].reviews).toBe(Math.max(...PRODUCTS.map(p => p.reviews)));
});

test('sorts by price both ways', () => {
  const low = run({sort: 'low'}).map(p => p.price);
  expect(low).toEqual([...low].sort((a, b) => a - b));
  const high = run({sort: 'high'}).map(p => p.price);
  expect(high).toEqual([...high].sort((a, b) => b - a));
});

test('concern and category filters combine', () => {
  const list = run({concerns: ['diabetes'], categories: ['natural-gond']});
  expect(list.map(p => p.id)).toEqual(['gond-jamun']);
});

test('several price ranges match any of them', () => {
  const list = run({priceRanges: ['under300', 'above900']});
  expect(list.length).toBeGreaterThan(0);
  expect(list.every(p => p.price < 300 || p.price > 900)).toBe(true);
});

test('rating and in-stock filters', () => {
  expect(run({minRating: 4.8}).every(p => p.rating >= 4.8)).toBe(true);
  expect(run({inStockOnly: true}).some(p => !p.inStock)).toBe(false);
});

test('does not change the original list order', () => {
  const before = PRODUCTS.map(p => p.id);
  run({sort: 'high'});
  expect(PRODUCTS.map(p => p.id)).toEqual(before);
});

test('counts active filters, ignoring sort', () => {
  expect(countActiveFilters(DEFAULT_FILTERS)).toBe(0);
  expect(
    countActiveFilters({...DEFAULT_FILTERS, sort: 'low', concerns: ['skin', 'hair'], inStockOnly: true}),
  ).toBe(3);
});
