const {withJsonNulls} = require('../common/json');

// Reads the company's own public Shopify product list (https://atiyaherbs.com/products.json) and saves it in our
// products table. The mapping is plain code with no network or database in it, so it can be tested with a fixture.
// The fetching is polite on purpose: a clear User-Agent, a pause between pages, and it stops on a 429 instead of
// hammering the site.

const SITE = 'https://atiyaherbs.com';
const USER_AGENT = 'AtiyaHerbs-Catalog-Import/1.0 (company developer tool)';
const PAGE_SIZE = 250;
const PAUSE_BETWEEN_PAGES_MS = 3000;
const DEFAULT_STOCK = 100;

const ENTITIES = {'&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ', '&rsquo;': "'", '&lsquo;': "'", '&ldquo;': '"', '&rdquo;': '"', '&ndash;': '-', '&mdash;': '-'};

// Shopify descriptions are HTML. The app shows plain text.
function htmlToText(html) {
  if (!html) {
    return '';
  }
  return String(html)
    .replace(/<\s*(br|\/p|\/li|\/h[1-6]|\/div)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|rsquo|lsquo|ldquo|rdquo|ndash|mdash|#39);/g, m => ENTITIES[m] ?? m)
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 4000);
}

const slugify = text =>
  String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');

// First match wins. These map the shop's own words onto the categories and concerns the app already has.
const CATEGORY_RULES = [
  [/gond/, 'natural-gond'],
  [/vinegar|sirka/, 'vinegar'],
  [/\btea\b|chai|kahwa|kehwa/, 'herbal-tea'],
  [/\bhair\b|baal/, 'hair-care'],
  [/\bskin\b|face|cream|soap|glow|acne|pimple|ubtan|lotion/, 'skin-care'],
  [/immun/, 'immunity'],
  [/capsule|tablet|syrup|churna|majun|medicine|jawarish|khamira|sharbat|safoof|\boil\b/, 'herbal-medicine'],
  [/powder|seed|herb|jadi|booti|root|leaf|single/, 'single-herb'],
];

const CONCERN_RULES = [
  [/joint|arthritis|ghutn|knee|gout/, 'joint-pain'],
  [/back\s*pain|spine|sciatica|kamar/, 'back-pain'],
  [/diabet|diabit|sugar/, 'diabetes'],
  [/\bgut\b|digest|acidity|constipation|stomach|liver|bloating/, 'gut-health'],
  [/\bhair\b|baal|dandruff/, 'hair'],
  [/\bskin\b|acne|pimple|face|glow/, 'skin'],
  [/weight|slim|obesity|\bfat\b/, 'weight-loss'],
  [/immun/, 'immunity'],
];

// A real product can be on a shelf even if the shop's "available" flag is missing: only an explicit false is sold out
const isAvailable = variant => variant.available !== false;

// One Shopify product -> one row for our products table (plus its category and concerns).
// `known` = {categories: Set of ids, concerns: Set of ids} already in the database.
function mapShopifyProduct(product, known, {defaultStock = DEFAULT_STOCK} = {}) {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const main = variants.find(isAvailable) ?? variants[0];
  const id = slugify(product.handle || product.title);
  if (!id || !product.title || !main) {
    return null; // nothing sensible to save
  }
  const price = Math.round(parseFloat(main.price));
  if (!Number.isFinite(price) || price < 0) {
    return null;
  }
  const compareAt = Math.round(parseFloat(main.compare_at_price));
  const mrp = Number.isFinite(compareAt) && compareAt > price ? compareAt : price;

  const tags = Array.isArray(product.tags) ? product.tags : String(product.tags || '').split(',');
  const haystack = [product.title, product.product_type, ...tags].join(' ').toLowerCase();
  const description = htmlToText(product.body_html);
  const rule = CATEGORY_RULES.find(([pattern]) => pattern.test(haystack));
  let categoryId = rule ? rule[1] : null;
  if (!categoryId) {
    // The shop's "product type" is often a health problem (Anxiety, Joints Pain, ...), not a shelf. Those go to the
    // general herbal medicine shelf, and the problem is picked up as a concern below. A type that already is one of
    // our categories is kept.
    const type = slugify(product.product_type);
    categoryId = type && known.categories.has(type) ? type : 'herbal-medicine';
  }
  const concernText = `${haystack} ${description.toLowerCase()}`;
  const concernIds = [...new Set(CONCERN_RULES.filter(([pattern]) => pattern.test(concernText)).map(([, concern]) => concern))].filter(c => known.concerns.has(c));

  const images = (Array.isArray(product.images) ? product.images : []).map(image => image.src).filter(src => typeof src === 'string' && src.startsWith('https://')).slice(0, 10);
  const size = main.title && main.title !== 'Default Title' ? String(main.title).slice(0, 60) : null;

  return {
    row: {
      id,
      name: String(product.title).trim().slice(0, 150),
      categoryId,
      price,
      mrp,
      images,
      description,
      size,
    },
    stock: variants.some(isAvailable) ? defaultStock : 0,
    concernIds,
  };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Downloads every page of /products.json. `fetchImpl` and `wait` can be replaced in tests.
// A 429 (too many requests) is waited out up to `maxRetries` times, then the import stops with a clear message.
async function fetchAllProducts({site = SITE, fetchImpl = fetch, wait = sleep, maxRetries = 3, pauseMs = PAUSE_BETWEEN_PAGES_MS, onPage = () => {}, maxPages = 20} = {}) {
  const all = [];
  for (let page = 1; page <= maxPages; page += 1) {
    let attempt = 0;
    let body;
    for (;;) {
      const res = await fetchImpl(`${site}/products.json?limit=${PAGE_SIZE}&page=${page}`, {headers: {'User-Agent': USER_AGENT, Accept: 'application/json'}});
      if (res.status === 429) {
        const retryAfter = Math.min(300, Math.max(1, parseInt(res.headers?.get?.('retry-after') ?? '60', 10) || 60));
        if (attempt >= maxRetries) {
          throw new Error(`The site is rate limiting us (429, retry after ${retryAfter}s). Nothing was saved. Wait a few minutes and run it again.`);
        }
        attempt += 1;
        await wait(retryAfter * 1000);
        continue;
      }
      if (!res.ok) {
        throw new Error(`The site answered HTTP ${res.status} for page ${page}. Nothing was saved.`);
      }
      try {
        body = await res.json();
      } catch {
        throw new Error(`Page ${page} was not valid JSON. Nothing was saved.`);
      }
      break;
    }
    const products = Array.isArray(body?.products) ? body.products : [];
    all.push(...products);
    onPage(page, products.length);
    if (products.length < PAGE_SIZE) {
      break;
    }
    await wait(pauseMs);
  }
  return all;
}

// Saves the mapped products. New products get the default stock; an existing product keeps its live stock, rating,
// badge, benefits and its other hand-written fields, and only its shop details (name, prices, photos, text, size,
// category) are refreshed. Nothing is deleted. With hideOthers, products that are NOT on the site any more are only
// switched off (active=false), never removed.
async function saveProducts(db, mapped, {hideOthers = false} = {}) {
  const counts = {created: 0, updated: 0, hidden: 0};
  for (const item of mapped) {
    const existing = await db.product.findUnique({where: {id: item.row.id}});
    if (existing) {
      await db.product.update({where: {id: item.row.id}, data: withJsonNulls(item.row)});
      counts.updated += 1;
    } else {
      await db.product.create({data: withJsonNulls({...item.row, stock: item.stock})});
      if (item.concernIds.length) {
        await db.productConcern.createMany({data: item.concernIds.map(concernId => ({productId: item.row.id, concernId}))});
      }
      counts.created += 1;
    }
  }
  if (hideOthers) {
    const keep = mapped.map(item => item.row.id);
    const result = await db.product.updateMany({where: {active: true, id: {notIn: keep}}, data: {active: false}});
    counts.hidden = result.count;
  }
  return counts;
}

module.exports = {htmlToText, slugify, mapShopifyProduct, fetchAllProducts, saveProducts, SITE, USER_AGENT, DEFAULT_STOCK};
