const request = require('supertest');
const {buildSeedData, seedCatalog, imageKey} = require('../src/catalog/seed');
const {buildTestApp} = require('./helpers/testApp');
const {loadShop, SAMPLE} = require('./helpers/shop');

const API = '/api/v1';

async function shop() {
  const t = buildTestApp();
  await loadShop(t.prisma);
  return t;
}

describe('the seed', () => {
  test('fills the shop from the sample catalog, and running it again changes nothing but keeps live stock', async () => {
    const t = buildTestApp();
    const data = buildSeedData(SAMPLE);
    expect(await seedCatalog(t.prisma, data)).toEqual({categories: 2, concerns: 2, products: 3, banners: 1, coupons: 1});
    await t.prisma.product.update({where: {id: 't-care'}, data: {stock: 7}});
    await seedCatalog(t.prisma, data);
    expect(t.prisma.product.rows).toHaveLength(3);
    expect(t.prisma.productConcern.rows).toHaveLength(2);
    expect(t.prisma.category.rows).toHaveLength(2);
    expect(t.prisma.product.rows.find(p => p.id === 't-care').stock).toBe(7); // not reset to the starting stock
    expect(t.prisma.product.rows.find(p => p.id === 'sold-out').stock).toBe(0);
  });

  test('a bundled banner image becomes a short key', () => {
    expect(imageKey({file: '../assets/images/banner_gond_siyah.jpg'})).toBe('banner_gond_siyah');
  });
});

describe('public shop reads', () => {
  test('lists categories, concerns and banners with no login', async () => {
    const t = await shop();
    const categories = await request(t.app).get(`${API}/categories`).expect(200);
    expect(categories.body.map(c => c.id)).toEqual(['herbal-medicine', 'vinegar']);
    const concerns = await request(t.app).get(`${API}/concerns`).expect(200);
    expect(concerns.body[0]).toEqual({id: 'joint-pain', name: 'Joint Pain', icon: 'arm', tint: '#E8F5E9'});
    const banners = await request(t.app).get(`${API}/banners`).expect(200);
    expect(banners.body[0]).toMatchObject({title: 'Authentic remedies', image: 'banner_one'});
  });

  test('lists products with filters and pages, and hides switched-off products', async () => {
    const t = await shop();
    const all = await request(t.app).get(`${API}/products`).expect(200);
    expect(all.body).toMatchObject({page: 1, pageSize: 20, total: 3});
    expect(all.body.items[0].id).toBe('t-care'); // best sellers first

    const byCategory = await request(t.app).get(`${API}/products?category=vinegar`).expect(200);
    expect(byCategory.body.items.map(p => p.id).sort()).toEqual(['cumin-vinegar', 'sold-out']);
    const byConcern = await request(t.app).get(`${API}/products?concern=joint-pain`).expect(200);
    expect(byConcern.body.items.map(p => p.id)).toEqual(['t-care']);
    const search = await request(t.app).get(`${API}/products?q=cumin`).expect(200);
    expect(search.body.items.map(p => p.id)).toEqual(['cumin-vinegar']);
    const page2 = await request(t.app).get(`${API}/products?pageSize=2&page=2`).expect(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.total).toBe(3);

    await t.prisma.product.update({where: {id: 'cumin-vinegar'}, data: {active: false}});
    const after = await request(t.app).get(`${API}/products`).expect(200);
    expect(after.body.total).toBe(2);
    await request(t.app).get(`${API}/products/cumin-vinegar`).expect(404);
  });

  test('a product shows what the app needs, and the exact stock stays private', async () => {
    const t = await shop();
    const res = await request(t.app).get(`${API}/products/t-care`).expect(200);
    expect(res.body).toMatchObject({
      id: 't-care',
      category: 'herbal-medicine',
      concerns: ['joint-pain'],
      price: 899,
      mrp: 1099,
      discountPercent: 18,
      inStock: true,
      image: 'https://example.com/t-care.jpg',
    });
    expect(res.body).not.toHaveProperty('stock');
    expect((await request(t.app).get(`${API}/products/sold-out`)).body.inStock).toBe(false);
    await request(t.app).get(`${API}/products/nope`).expect(404);
  });

  test('bad queries are refused without echoing them', async () => {
    const t = await shop();
    for (const query of ['pageSize=500', 'page=0', 'bogus=1', 'category=Not%20A%20Slug']) {
      const res = await request(t.app).get(`${API}/products?${query}`);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain('Not A Slug');
    }
  });
});

describe('coupons', () => {
  test('tells what a coupon takes off, and gives one answer for every way it can fail', async () => {
    const t = await shop();
    const ok = await request(t.app).post(`${API}/coupons/validate`).send({code: 'atiya10', subtotal: 1000}).expect(200);
    expect(ok.body).toEqual({code: 'ATIYA10', label: '10% off on your order', percent: 10, discount: 100, total: 900});

    await t.prisma.coupon.update({where: {code: 'ATIYA10'}, data: {minSubtotal: 2000}});
    const small = await request(t.app).post(`${API}/coupons/validate`).send({code: 'ATIYA10', subtotal: 1000}).expect(400);
    const unknown = await request(t.app).post(`${API}/coupons/validate`).send({code: 'NOPE99', subtotal: 1000}).expect(400);
    expect(small.body.message).toBe(unknown.body.message);

    await t.prisma.coupon.update({where: {code: 'ATIYA10'}, data: {minSubtotal: 0, expiresAt: new Date(Date.now() - 1000)}});
    await request(t.app).post(`${API}/coupons/validate`).send({code: 'ATIYA10', subtotal: 1000}).expect(400);
    await t.prisma.coupon.update({where: {code: 'ATIYA10'}, data: {expiresAt: null, maxDiscount: 40}});
    expect((await request(t.app).post(`${API}/coupons/validate`).send({code: 'ATIYA10', subtotal: 1000})).body.discount).toBe(40);
    await t.prisma.coupon.update({where: {code: 'ATIYA10'}, data: {active: false}});
    await request(t.app).post(`${API}/coupons/validate`).send({code: 'ATIYA10', subtotal: 1000}).expect(400);
  });

  test('rejects a subtotal sent as text or a negative one, and extra fields', async () => {
    const t = await shop();
    for (const body of [{code: 'ATIYA10', subtotal: '1000'}, {code: 'ATIYA10', subtotal: -5}, {code: 'ATIYA10', subtotal: 100, percent: 99}]) {
      await request(t.app).post(`${API}/coupons/validate`).send(body).expect(400);
    }
  });
});

describe('admin changes to the shop', () => {
  const NEW_PRODUCT = {
    id: 'gond-oil',
    name: 'Gond Oil',
    categoryId: 'herbal-medicine',
    concernIds: ['joint-pain', 'skin'],
    price: 400,
    mrp: 500,
    stock: 25,
    images: ['https://example.com/oil.jpg'],
    description: 'A massage oil.',
  };

  test('only an admin can change anything', async () => {
    const t = await shop();
    await request(t.app).post(`${API}/products`).send(NEW_PRODUCT).expect(401);
    const customer = await t.login('9123456780');
    await request(t.app).post(`${API}/products`).set(t.bearer(customer)).send(NEW_PRODUCT).expect(403);
    await request(t.app).delete(`${API}/products/t-care`).set(t.bearer(customer)).expect(403);
    await request(t.app).get(`${API}/admin/products`).set(t.bearer(customer)).expect(403);
    await request(t.app).post(`${API}/coupons`).set(t.bearer(customer)).send({code: 'FREE100', label: 'Free', percent: 100}).expect(403);
    expect(t.prisma.product.rows).toHaveLength(3);
  });

  test('an admin adds, edits and removes a product', async () => {
    const t = await shop();
    const admin = await t.loginAs('admin');
    const created = await request(t.app).post(`${API}/products`).set(t.bearer(admin)).send(NEW_PRODUCT).expect(201);
    expect(created.body).toMatchObject({id: 'gond-oil', concerns: ['joint-pain', 'skin'], stock: 25, active: true});
    await request(t.app).post(`${API}/products`).set(t.bearer(admin)).send(NEW_PRODUCT).expect(409);

    const edited = await request(t.app).patch(`${API}/products/gond-oil`).set(t.bearer(admin)).send({price: 350, stock: 10, concernIds: ['skin']}).expect(200);
    expect(edited.body).toMatchObject({price: 350, stock: 10, concerns: ['skin']});
    // price above the MRP is refused, also when only one of the two is sent
    await request(t.app).patch(`${API}/products/gond-oil`).set(t.bearer(admin)).send({price: 900}).expect(409);
    await request(t.app).patch(`${API}/products/gond-oil`).set(t.bearer(admin)).send({}).expect(400);

    const list = await request(t.app).get(`${API}/admin/products`).set(t.bearer(admin)).expect(200);
    expect(list.body.items.find(p => p.id === 'gond-oil')).toHaveProperty('stock', 10);

    const removed = await request(t.app).delete(`${API}/products/gond-oil`).set(t.bearer(admin)).expect(200);
    expect(removed.body).toEqual({deleted: true, deactivated: false});
    expect(t.prisma.productConcern.rows.filter(l => l.productId === 'gond-oil')).toHaveLength(0);
    await request(t.app).get(`${API}/products/gond-oil`).expect(404);
  });

  test('a product that was ordered is switched off instead of deleted', async () => {
    const t = await shop();
    const admin = await t.loginAs('admin');
    await t.prisma.orderItem.create({data: {orderId: 'o1', productId: 't-care', name: 'T Care', price: 899, qty: 1}});
    const res = await request(t.app).delete(`${API}/products/t-care`).set(t.bearer(admin)).expect(200);
    expect(res.body).toEqual({deleted: false, deactivated: true});
    expect(t.prisma.product.rows.find(p => p.id === 't-care').active).toBe(false);
  });

  test('strict input: unknown fields, bad ids, a missing category and http images are refused', async () => {
    const t = await shop();
    const admin = await t.loginAs('admin');
    const post = body => request(t.app).post(`${API}/products`).set(t.bearer(admin)).send(body);
    expect((await post({...NEW_PRODUCT, secret: 1})).status).toBe(400);
    expect((await post({...NEW_PRODUCT, id: 'Bad Id'})).status).toBe(400);
    expect((await post({...NEW_PRODUCT, images: ['http://example.com/x.jpg']})).status).toBe(400);
    expect((await post({...NEW_PRODUCT, price: 600})).status).toBe(400);
    expect((await post({...NEW_PRODUCT, name: '<script>'})).status).toBe(400);
    expect((await post({...NEW_PRODUCT, categoryId: 'nothing'})).status).toBe(404);
    expect((await post({...NEW_PRODUCT, concernIds: ['nothing']})).status).toBe(404);
    expect(t.prisma.product.rows).toHaveLength(3);
  });

  test('categories: add, rename, and refuse to delete one that still has products', async () => {
    const t = await shop();
    const admin = await t.loginAs('admin');
    const made = await request(t.app).post(`${API}/categories`).set(t.bearer(admin)).send({id: 'hair-care', name: 'Hair Care', icon: 'face'}).expect(201);
    expect(made.body.id).toBe('hair-care');
    await request(t.app).post(`${API}/categories`).set(t.bearer(admin)).send({id: 'hair-care', name: 'Again', icon: 'x1'}).expect(409);
    await request(t.app).patch(`${API}/categories/hair-care`).set(t.bearer(admin)).send({name: 'Hair'}).expect(200);
    await request(t.app).delete(`${API}/categories/vinegar`).set(t.bearer(admin)).expect(409);
    await request(t.app).delete(`${API}/categories/hair-care`).set(t.bearer(admin)).expect(204);
    await request(t.app).delete(`${API}/categories/hair-care`).set(t.bearer(admin)).expect(404);
  });

  test('banners and coupons: add, change, remove', async () => {
    const t = await shop();
    const admin = await t.loginAs('admin');
    const banner = await request(t.app).post(`${API}/banners`).set(t.bearer(admin)).send({title: 'Winter sale', image: 'https://example.com/b.jpg', categoryId: 'vinegar'}).expect(201);
    await request(t.app).patch(`${API}/banners/${banner.body.id}`).set(t.bearer(admin)).send({title: 'Big sale'}).expect(200);
    expect((await request(t.app).get(`${API}/banners`)).body).toHaveLength(2);
    await request(t.app).delete(`${API}/banners/${banner.body.id}`).set(t.bearer(admin)).expect(204);
    expect((await request(t.app).get(`${API}/banners`)).body).toHaveLength(1);

    const coupon = await request(t.app).post(`${API}/coupons`).set(t.bearer(admin)).send({code: 'diwali20', label: '20% off', percent: 20, expiresAt: '2099-01-01T00:00:00Z'}).expect(201);
    expect(coupon.body.code).toBe('DIWALI20');
    await request(t.app).post(`${API}/coupons`).set(t.bearer(admin)).send({code: 'DIWALI20', label: 'again', percent: 5}).expect(409);
    await request(t.app).patch(`${API}/coupons/diwali20`).set(t.bearer(admin)).send({percent: 25}).expect(200);
    await request(t.app).post(`${API}/coupons`).set(t.bearer(admin)).send({code: 'BAD', label: 'x1', percent: 150}).expect(400);
    expect((await request(t.app).get(`${API}/coupons`).set(t.bearer(admin))).body.map(c => c.code)).toEqual(['ATIYA10', 'DIWALI20']);
    await request(t.app).delete(`${API}/coupons/DIWALI20`).set(t.bearer(admin)).expect(204);
  });

  test('admin changes are written to the audit trail', async () => {
    const t = await shop();
    const admin = await t.loginAs('admin');
    await request(t.app).post(`${API}/categories`).set(t.bearer(admin)).send({id: 'hair-care', name: 'Hair Care', icon: 'face'}).expect(201);
    expect(t.prisma.auditLog.rows.some(r => r.action === 'catalog.category.created')).toBe(true);
  });
});
