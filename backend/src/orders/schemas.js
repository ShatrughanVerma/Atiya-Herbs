const {z} = require('zod');
const {pagination, slug} = require('../common/schemas');

const ORDER_STATUSES = ['placed', 'confirmed', 'shipped', 'delivered', 'cancelled'];

// The client only says WHAT it wants. Prices, stock, the coupon discount and the total are worked out on the server.
const createOrderSchema = z
  .object({
    // Left out: the order is made from the person's cart on the server, and the cart is emptied with it
    items: z
      .array(z.object({productId: slug, qty: z.number().int().min(1).max(20)}).strict())
      .min(1)
      .max(30)
      .optional(),
    addressId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
    couponCode: z.string().trim().min(2).max(32).optional(),
    paymentMethod: z.literal('cod'), // cash on delivery only: no card or online payment is handled here
  })
  .strict();

const listOrdersQuerySchema = z.object({...pagination}).strict();

const adminListQuerySchema = z.object({status: z.enum(ORDER_STATUSES).optional(), ...pagination}).strict();

const updateStatusSchema = z.object({status: z.enum(ORDER_STATUSES)}).strict();

module.exports = {createOrderSchema, listOrdersQuerySchema, adminListQuerySchema, updateStatusSchema, ORDER_STATUSES};
