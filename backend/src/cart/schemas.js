const {z} = require('zod');
const {slug} = require('../common/schemas');

const MAX_QTY = 10; // most of one product in a cart
const MAX_LINES = 30; // most different products in a cart

// 0 removes the line
const setQuantitySchema = z.object({quantity: z.number().int().min(0).max(MAX_QTY)}).strict();

// A guest's local cart, sent once after login
const mergeSchema = z
  .object({
    items: z
      .array(z.object({productId: slug, quantity: z.number().int().min(1).max(MAX_QTY)}).strict())
      .max(MAX_LINES),
  })
  .strict();

module.exports = {setQuantitySchema, mergeSchema, MAX_QTY, MAX_LINES};
