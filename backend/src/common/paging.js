// Turns {page, pageSize} into Prisma's skip / take, and wraps a page of rows the same way everywhere.
const pageArgs = ({page, pageSize}) => ({skip: (page - 1) * pageSize, take: pageSize});

const pageOf = (items, total, {page, pageSize}) => ({items, page, pageSize, total});

module.exports = {pageArgs, pageOf};
