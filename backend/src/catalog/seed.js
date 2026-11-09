const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {withJsonNulls} = require('../common/json');

// Fills the shop tables from the app's sample catalog (src/data/catalog.js), so the first real data is the data
// the app already shows. Safe to run again and again: rows are matched by id and updated, never duplicated, and the
// live stock of an existing product is left alone.

const INITIAL_STOCK = 100; // for a product the sample data calls "in stock"

// Bundled images are require('../assets/images/x.jpg') in the app: keep just the key "x"
const imageKey = asset => {
  const file = typeof asset === 'string' ? asset : asset?.file;
  return file ? path.basename(file).replace(/\.[a-z0-9]+$/i, '') : 'banner';
};

// Turns the sample catalog (the object exported by catalog.js) into rows for the database
function buildSeedData(catalog) {
  const categories = catalog.CATEGORIES.map((c, index) => ({id: c.id, name: c.name, icon: c.icon, sortOrder: index}));
  const concerns = catalog.CONCERNS.map((c, index) => ({id: c.id, name: c.name, icon: c.icon, tint: c.tint, sortOrder: index}));
  const products = catalog.PRODUCTS.map(p => ({
    row: {
      id: p.id,
      name: p.name,
      categoryId: p.category,
      price: p.price,
      mrp: p.mrp,
      images: p.images,
      description: p.description ?? '',
      benefits: p.benefits ?? null,
      howToUse: p.howToUse ?? null,
      ingredients: p.ingredients ?? null,
      size: p.size ?? null,
      badge: p.badge ?? null,
      bestseller: !!p.bestseller,
      rating: p.rating ?? 0,
      reviewCount: p.reviews ?? 0,
    },
    stock: p.inStock === false ? 0 : INITIAL_STOCK,
    concernIds: p.concerns ?? [],
  }));
  const banners = catalog.BANNERS.map((b, index) => ({
    id: `seed-banner-${b.id}`,
    badge: b.badge ?? null,
    title: b.title,
    image: imageKey(b.image),
    gradient: b.gradient ?? null,
    concernId: b.concern ?? null,
    categoryId: b.category ?? null,
    sortOrder: index,
  }));
  const coupons = Object.values(catalog.COUPONS).map(c => ({code: c.code, percent: c.percent, label: c.label}));
  return {categories, concerns, products, banners, coupons};
}

// Writes the rows. `db` is the Prisma client.
async function seedCatalog(db, data) {
  const upsert = async (table, where, create, update = create) => {
    if (await table.findUnique({where})) {
      await table.update({where, data: update});
    } else {
      await table.create({data: create});
    }
  };

  for (const c of data.categories) {
    await upsert(db.category, {id: c.id}, c);
  }
  for (const c of data.concerns) {
    await upsert(db.concern, {id: c.id}, c);
  }
  for (const {row, stock, concernIds} of data.products) {
    await upsert(db.product, {id: row.id}, withJsonNulls({...row, stock}), withJsonNulls(row)); // an existing product keeps its live stock
    await db.productConcern.deleteMany({where: {productId: row.id}});
    if (concernIds.length) {
      await db.productConcern.createMany({data: concernIds.map(concernId => ({productId: row.id, concernId}))});
    }
  }
  for (const b of data.banners) {
    await upsert(db.banner, {id: b.id}, b);
  }
  for (const c of data.coupons) {
    await upsert(db.coupon, {code: c.code}, c, {percent: c.percent, label: c.label});
  }
  return {
    categories: data.categories.length,
    concerns: data.concerns.length,
    products: data.products.length,
    banners: data.banners.length,
    coupons: data.coupons.length,
  };
}

// catalog.js is an ES module written for the app: it uses require() for bundled images. Copy it to a temp .mjs file
// with that require replaced, and import it. The app's file is only read, never changed.
async function loadCatalogFile(file) {
  const source = fs
    .readFileSync(file, 'utf8')
    .replace(/require\((['"])([^'"]+)\1\)/g, (match, quote, asset) => JSON.stringify({file: asset}));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atiya-seed-'));
  const copy = path.join(dir, 'catalog.mjs');
  fs.writeFileSync(copy, source);
  try {
    return await import(pathToFileURL(copy).href);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

module.exports = {buildSeedData, seedCatalog, loadCatalogFile, imageKey};
