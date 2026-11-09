const {buildSeedData, seedCatalog} = require('../../src/catalog/seed');

// A tiny shop for the tests, loaded through the same seed code the real catalog uses
const SAMPLE = {
  CATEGORIES: [
    {id: 'herbal-medicine', name: 'Herbal Medicine', icon: 'bottle'},
    {id: 'vinegar', name: 'Vinegars', icon: 'bottle-tonic'},
  ],
  CONCERNS: [
    {id: 'joint-pain', name: 'Joint Pain', icon: 'arm', tint: '#E8F5E9'},
    {id: 'skin', name: 'Skin', icon: 'face', tint: '#FFF3E0'},
  ],
  PRODUCTS: [
    {id: 't-care', name: 'T Care Capsules', category: 'herbal-medicine', concerns: ['joint-pain'], size: '60 Capsules', price: 899, mrp: 1099, rating: 4.8, reviews: 342, images: ['https://example.com/t-care.jpg'], bestseller: true, description: 'A Unani formulation for joints.', inStock: true},
    {id: 'cumin-vinegar', name: 'Cumin Vinegar', category: 'vinegar', concerns: ['skin'], size: '500 ml', price: 250, mrp: 300, rating: 4.5, reviews: 20, images: ['https://example.com/cumin.jpg'], description: 'Natural cumin vinegar.', inStock: true},
    {id: 'sold-out', name: 'Sold Out Oil', category: 'vinegar', concerns: [], price: 100, mrp: 120, images: ['https://example.com/x.jpg'], description: 'Nothing left.', inStock: false},
  ],
  BANNERS: [{id: '1', badge: 'NEW', title: 'Authentic remedies', concern: null, image: {file: '../assets/images/banner_one.jpg'}}],
  COUPONS: {ATIYA10: {code: 'ATIYA10', percent: 10, label: '10% off on your order'}},
};

async function loadShop(prisma) {
  await seedCatalog(prisma, buildSeedData(SAMPLE));
}

const ADDRESS = {name: 'Asha Khan', phone: '9876543210', pincode: '226001', city: 'Lucknow', state: 'Uttar Pradesh', line1: '12 Hakim Street, Chowk'};

module.exports = {loadShop, SAMPLE, ADDRESS};
