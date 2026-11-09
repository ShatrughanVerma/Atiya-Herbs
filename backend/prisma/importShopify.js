// npm run db:import-shopify [-- --dry-run] [--hide-others] [--default-stock=100] [--max-retries=3]
//
// Copies the products of the company website (the public https://atiyaherbs.com/products.json) into the products
// table. Safe to run again: matched by product handle and updated, never duplicated, and the live stock of a product
// that is already in the database is never changed.
//
//   --dry-run          only reads the site and shows what WOULD be saved (a count and a few mapped samples)
//   --hide-others      products that are not on the site (for example the sample products from db:seed) are switched
//                      off (active=false), not deleted. They can be switched on again.
//   --default-stock=N  stock given to a NEW product the site lists as available (the public list has no stock numbers)
//   --max-retries=N    how many times to wait out a "too many requests" (429) answer; 0 = stop at the first one
//   --file=PATH        read a products.json you saved yourself (open the address in a browser, Save as) instead of
//                      asking the site. Use this if the site keeps answering 429 to scripts.
try {
  process.loadEnvFile();
} catch {
  // no .env file: the settings come from real environment variables
}

const fs = require('node:fs');
const {loadConfig} = require('../src/config/env');
const {createPrismaClient} = require('../src/prisma/client');
const {DEFAULT_STOCK, fetchAllProducts, mapShopifyProduct, saveProducts} = require('../src/catalog/shopifyImport');

const flag = name => process.argv.includes(`--${name}`);
const option = (name, fallback) => {
  const found = process.argv.find(arg => arg.startsWith(`--${name}=`));
  return found ? Number(found.split('=')[1]) : fallback;
};
const text = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;

async function main() {
  const dryRun = flag('dry-run');
  const defaultStock = option('default-stock', DEFAULT_STOCK);
  const maxRetries = option('max-retries', 3);
  if (!Number.isInteger(defaultStock) || defaultStock < 0 || defaultStock > 10_000) {
    throw new Error('--default-stock must be a whole number from 0 to 10000.');
  }

  // A dry run needs no database; it only reads the site. The category and concern names it checks against are the
  // standard ones the app already has.
  let prisma = null;
  let known = {
    categories: new Set(['herbal-medicine', 'immunity', 'hair-care', 'skin-care', 'natural-gond', 'vinegar', 'herbal-tea', 'single-herb']),
    concerns: new Set(['joint-pain', 'back-pain', 'diabetes', 'gut-health', 'hair', 'skin', 'weight-loss', 'immunity']),
  };
  if (!dryRun) {
    prisma = createPrismaClient(loadConfig());
    known = {
      categories: new Set((await prisma.category.findMany({})).map(c => c.id)),
      concerns: new Set((await prisma.concern.findMany({})).map(c => c.id)),
    };
  }

  try {
    const file = text('file');
    let products;
    if (file) {
      console.log(`Reading ${file} ...`);
      products = JSON.parse(fs.readFileSync(file, 'utf8')).products;
      if (!Array.isArray(products)) {
        throw new Error('That file has no "products" list. Save the page https://atiyaherbs.com/products.json?limit=250 as it is.');
      }
    } else {
      console.log('Reading https://atiyaherbs.com/products.json ...');
      products = await fetchAllProducts({maxRetries, onPage: (page, count) => console.log(`  page ${page}: ${count} products`)});
    }
    const mapped = products.map(p => mapShopifyProduct(p, known, {defaultStock})).filter(Boolean);
    const skipped = products.length - mapped.length;
    console.log(`Found ${products.length} products, ${mapped.length} can be saved${skipped ? `, ${skipped} skipped (no price or name)` : ''}.`);

    if (dryRun) {
      const byCategory = {};
      mapped.forEach(m => {
        byCategory[m.row.categoryId] = (byCategory[m.row.categoryId] ?? 0) + 1;
      });
      console.log('By category:', byCategory);
      console.log('Sold out on the site:', mapped.filter(m => m.stock === 0).length);
      console.log('Sample (first 2):');
      mapped.slice(0, 2).forEach(m => console.log(JSON.stringify({...m.row, description: `${m.row.description.slice(0, 120)}...`, stock: m.stock, concerns: m.concernIds}, null, 2)));
      console.log('Dry run: nothing was saved.');
      return;
    }
    const counts = await saveProducts(prisma, mapped, {hideOthers: flag('hide-others')});
    console.log('Saved:', counts);
  } finally {
    await prisma?.$disconnect();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
