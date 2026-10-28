export const SORT_OPTIONS = [
  {id: 'popular', label: 'Popularity'},
  {id: 'rating', label: 'Customer rating'},
  {id: 'low', label: 'Price: Low to High'},
  {id: 'high', label: 'Price: High to Low'},
  {id: 'discount', label: 'Biggest discount'},
];

export const PRICE_RANGES = [
  {id: 'under300', label: 'Under ₹300', min: 0, max: 299},
  {id: '300to600', label: '₹300 – ₹600', min: 300, max: 600},
  {id: '600to900', label: '₹600 – ₹900', min: 601, max: 900},
  {id: 'above900', label: 'Above ₹900', min: 901, max: Infinity},
];

export const RATING_OPTIONS = [
  {id: 4.5, label: '4.5★ & above'},
  {id: 4, label: '4★ & above'},
];

export const DEFAULT_FILTERS = {
  sort: 'popular',
  categories: [],
  concerns: [],
  priceRanges: [],
  minRating: null,
  inStockOnly: false,
};

const sorters = {
  popular: (a, b) => b.reviews - a.reviews,
  rating: (a, b) => b.rating - a.rating,
  low: (a, b) => a.price - b.price,
  high: (a, b) => b.price - a.price,
  discount: (a, b) => (b.mrp - b.price) / b.mrp - (a.mrp - a.price) / a.mrp,
};

/** Number of filters the user has turned on (sort is not counted). */
export const countActiveFilters = f =>
  f.categories.length +
  f.concerns.length +
  f.priceRanges.length +
  (f.minRating ? 1 : 0) +
  (f.inStockOnly ? 1 : 0);

/** Returns a new, sorted list. Inside one group (e.g. two categories) a product may match any; groups combine with AND. */
export function applyFilters(products, f) {
  const ranges = PRICE_RANGES.filter(r => f.priceRanges.includes(r.id));
  return products
    .filter(
      p =>
        (f.categories.length === 0 || f.categories.includes(p.category)) &&
        (f.concerns.length === 0 || p.concerns.some(c => f.concerns.includes(c))) &&
        (ranges.length === 0 || ranges.some(r => p.price >= r.min && p.price <= r.max)) &&
        (!f.minRating || p.rating >= f.minRating) &&
        (!f.inStockOnly || p.inStock),
    )
    .sort(sorters[f.sort] || sorters.popular);
}
