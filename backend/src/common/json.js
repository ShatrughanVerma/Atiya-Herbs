const {Prisma} = require('@prisma/client');

// Prisma wants a special marker, not plain null, to store "no value" in a JSON column
const jsonOrNull = value => (value === null ? Prisma.DbNull : value);

// Same for the optional JSON fields of a product
const withJsonNulls = fields => ('benefits' in fields ? {...fields, benefits: jsonOrNull(fields.benefits)} : fields);

module.exports = {jsonOrNull, withJsonNulls};
