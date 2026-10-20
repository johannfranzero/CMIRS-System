export function createMockReadSupabase(responses = {}) {
  const operations = [];

  return {
    operations,
    from(table) {
      const operation = {
        table,
        select: null,
        orders: [],
        range: null,
        limit: null,
      };
      operations.push(operation);

      const query = {
        select(columns, options) {
          operation.select = { columns, options };
          return query;
        },
        order(column, options) {
          operation.orders.push({ column, options });
          return query;
        },
        range(from, to) {
          operation.range = { from, to };
          return Promise.resolve(responses[table] ?? { data: [], count: 0, error: null });
        },
        limit(count) {
          operation.limit = count;
          return Promise.resolve(responses[table] ?? { data: [], count: 0, error: null });
        },
      };

      return query;
    },
  };
}
