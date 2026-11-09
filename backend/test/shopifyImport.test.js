const {createFakePrisma} = require('./helpers/fakePrisma');
const {loadShop} = require('./helpers/shop');
const {fetchAllProducts, htmlToText, mapShopifyProduct, saveProducts} = require('../src/catalog/shopifyImport');

// Shaped like https://atiyaherbs.com/products.json (Shopify's public product list)
const FIXTURE = [
  {
    id: 1,
    title: 'Hakim Suleman’s Gond Siyah Capsule',
    handle: 'hakim-suleman-s-gond-siyah-capsule',
    body_html: '<p>For <strong>joint pain</strong> &amp; knee strength.</p><ul><li>Natural</li><li>No side effects</li></ul>',
    product_type: 'Capsules',
    tags: ['Joint Pain', 'bestseller'],
    variants: [{id: 11, title: '60 Capsules', price: '749.00', compare_at_price: '899.00', available: true}],
    images: [{src: 'https://atiyaherbs.com/cdn/shop/files/gond.jpg?v=1'}, {src: 'http://insecure.example/x.jpg'}],
  },
  {
    id: 2,
    title: 'Cumin Vinegar',
    handle: 'jeera-vinegar',
    body_html: '',
    product_type: '',
    tags: '',
    variants: [{id: 21, title: 'Default Title', price: '250', compare_at_price: null, available: false}],
    images: [],
  },
  {id: 3, title: 'Mystery Item', handle: 'mystery-item', body_html: 'x', product_type: 'Special Blends', tags: [], variants: [{id: 31, title: '1 kg', price: '100.00', compare_at_price: '90.00', available: true}], images: []},
  {id: 4, title: 'No price', handle: 'no-price', body_html: '', variants: [], images: []},
];

const KNOWN = {
  categories: new Set(['herbal-medicine', 'natural-gond', 'vinegar']),
  concerns: new Set(['joint-pain', 'skin']),
};

describe('mapping a Shopify product', () => {
  test('turns html into plain text', () => {
    expect(htmlToText('<p>For <b>joints</b> &amp; knees.</p><ul><li>One</li><li>Two</li></ul>')).toBe('For joints & knees.\n- One\n- Two');
    expect(htmlToText(null)).toBe('');
    expect(htmlToText('<script>x</script>a')).toBe('xa'); // tags are stripped, never kept
  });

  test('maps the fields, prices in whole rupees, https photos only, size from the variant', () => {
    const m = mapShopifyProduct(FIXTURE[0], KNOWN);
    expect(m.row).toMatchObject({
      id: 'hakim-suleman-s-gond-siyah-capsule',
      name: 'Hakim Suleman’s Gond Siyah Capsule',
      categoryId: 'natural-gond',
      price: 749,
      mrp: 899,
      size: '60 Capsules',
      images: ['https://atiyaherbs.com/cdn/shop/files/gond.jpg?v=1'],
    });
    expect(m.row.description).toBe('For joint pain & knee strength.\n- Natural\n- No side effects');
    expect(m.stock).toBe(100);
    expect(m.concernIds).toEqual(['joint-pain']);
  });

  test('a sold-out product has stock 0; no compare price means mrp = price; a Default Title has no size', () => {
    const m = mapShopifyProduct(FIXTURE[1], KNOWN);
    expect(m.row).toMatchObject({id: 'jeera-vinegar', categoryId: 'vinegar', price: 250, mrp: 250, size: null, images: []});
    expect(m.stock).toBe(0);
  });

  test('a compare price lower than the price is ignored, and an unknown product type goes to herbal medicine (no new category)', () => {
    const m = mapShopifyProduct(FIXTURE[2], KNOWN);
    expect(m.row).toMatchObject({price: 100, mrp: 100, categoryId: 'herbal-medicine'});
    expect(m.newCategory).toBeUndefined();
  });

  test('a health problem written as the product type is picked up as a concern, even when misspelt', () => {
    const m = mapShopifyProduct({title: 'Sugar Care', handle: 'sugar-care', product_type: 'Diabities', tags: [], variants: [{price: '500', available: true}]}, {...KNOWN, concerns: new Set([...KNOWN.concerns, 'diabetes'])});
    expect(m.row.categoryId).toBe('herbal-medicine');
    expect(m.concernIds).toContain('diabetes');
  });

  test('uses the default stock you give, and skips a product with no price or variant', () => {
    expect(mapShopifyProduct(FIXTURE[0], KNOWN, {defaultStock: 25}).stock).toBe(25);
    expect(mapShopifyProduct(FIXTURE[3], KNOWN)).toBeNull();
    expect(mapShopifyProduct({title: 'x', handle: 'x', variants: [{price: 'abc'}]}, KNOWN)).toBeNull();
  });
});

describe('downloading the product list politely', () => {
  const page = (products, status = 200, headers = {}) => ({
    status,
    ok: status >= 200 && status < 300,
    headers: {get: name => headers[name.toLowerCase()] ?? null},
    json: async () => ({products}),
  });

  test('sends a clear User-Agent and reads one short page', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({url, options});
      return page(FIXTURE);
    };
    const all = await fetchAllProducts({fetchImpl, wait: async () => {}});
    expect(all).toHaveLength(4);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://atiyaherbs.com/products.json?limit=250&page=1');
    expect(calls[0].options.headers['User-Agent']).toMatch(/AtiyaHerbs-Catalog-Import/);
  });

  test('goes to the next page when a page is full, with a pause between pages', async () => {
    const full = Array.from({length: 250}, (_, i) => ({id: i}));
    const waits = [];
    let n = 0;
    const fetchImpl = async () => page(++n === 1 ? full : [{id: 999}]);
    const all = await fetchAllProducts({fetchImpl, wait: async ms => waits.push(ms), pauseMs: 3000});
    expect(all).toHaveLength(251);
    expect(waits).toEqual([3000]);
  });

  test('waits out a 429 with its Retry-After, then carries on', async () => {
    const waits = [];
    let n = 0;
    const fetchImpl = async () => (++n === 1 ? page([], 429, {'retry-after': '7'}) : page(FIXTURE));
    const all = await fetchAllProducts({fetchImpl, wait: async ms => waits.push(ms)});
    expect(all).toHaveLength(4);
    expect(waits).toEqual([7000]);
  });

  test('stops with a clear message when it keeps getting 429, and with maxRetries 0 at the first one', async () => {
    const limited = async () => page([], 429, {'retry-after': '60'});
    await expect(fetchAllProducts({fetchImpl: limited, wait: async () => {}, maxRetries: 2})).rejects.toThrow(/rate limiting.*Nothing was saved/);
    let calls = 0;
    const counted = async () => {
      calls += 1;
      return page([], 429);
    };
    await expect(fetchAllProducts({fetchImpl: counted, wait: async () => {}, maxRetries: 0})).rejects.toThrow(/429/);
    expect(calls).toBe(1);
  });

  test('other errors and non-JSON stop the import', async () => {
    await expect(fetchAllProducts({fetchImpl: async () => page([], 500)})).rejects.toThrow(/HTTP 500/);
    await expect(fetchAllProducts({fetchImpl: async () => ({status: 200, ok: true, headers: {get: () => null}, json: async () => Promise.reject(new Error('bad'))})})).rejects.toThrow(/not valid JSON/);
  });
});

describe('saving the products', () => {
  const run = async (options, existing = false) => {
    const prisma = createFakePrisma();
    await loadShop(prisma);
    if (existing) {
      await prisma.product.create({data: {id: 'cumin-vinegar-x', name: 'Old', categoryId: 'vinegar', price: 1, mrp: 1, images: [], stock: 7, rating: 4.5}});
    }
    const mapped = FIXTURE.map(p => mapShopifyProduct(p, KNOWN)).filter(Boolean);
    return {prisma, mapped, counts: await saveProducts(prisma, mapped, options)};
  };

  test('creates new products with stock and concerns', async () => {
    const {prisma, counts} = await run({});
    expect(counts).toEqual({created: 3, updated: 0, hidden: 0});
    const gond = prisma.product.rows.find(p => p.id === 'hakim-suleman-s-gond-siyah-capsule');
    expect(gond).toMatchObject({stock: 100, price: 749, active: true});
    expect(prisma.productConcern.rows).toContainEqual(expect.objectContaining({productId: gond.id, concernId: 'joint-pain'}));
  });

  test('running again updates the shop details but never the stock, rating or badge, and never duplicates', async () => {
    const {prisma, mapped} = await run({});
    const gond = () => prisma.product.rows.find(p => p.id === 'hakim-suleman-s-gond-siyah-capsule');
    gond().stock = 40; // sold some since
    gond().rating = 4.9;
    mapped[0].row.price = 799; // the site changed the price
    const counts = await saveProducts(prisma, mapped, {});
    expect(counts).toMatchObject({created: 0, updated: 3});
    expect(gond()).toMatchObject({stock: 40, rating: 4.9, price: 799});
    expect(prisma.product.rows.filter(p => p.id === gond().id)).toHaveLength(1);
  });

  test('hide-others switches the other products off but deletes nothing', async () => {
    const {prisma, counts} = await run({hideOthers: true});
    expect(counts.hidden).toBe(3); // t-care, cumin-vinegar and sold-out from the sample shop
    expect(prisma.product.rows.find(p => p.id === 't-care').active).toBe(false);
    expect(prisma.product.rows.find(p => p.id === 'hakim-suleman-s-gond-siyah-capsule').active).toBe(true);
    expect(prisma.product.rows.length).toBe(6);
  });
});
