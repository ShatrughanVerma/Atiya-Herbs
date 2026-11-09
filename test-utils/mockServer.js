/* eslint-env jest */
// A fake server: routes is {'METHOD /path': (body, headers) => [status, json]}; every call is recorded
export const mockServer = routes => {
  const calls = [];
  global.fetch = jest.fn(async (url, init = {}) => {
    const path = url.replace(/^https?:\/\/[^/]+\/api\/v1/, '');
    const method = init.method || 'GET';
    const key = `${method} ${path}`;
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ key, body, auth: init.headers?.Authorization });
    // An exact route first; then the same path without its query string; then routes written with :params
    const [pathname, queryString = ''] = path.split('?');
    const query = Object.fromEntries(new URLSearchParams(queryString));
    let handler = routes[key] || routes[`${method} ${pathname}`];
    let params = {};
    if (!handler) {
      for (const [routeKey, routeHandler] of Object.entries(routes)) {
        const [routeMethod, routePath] = routeKey.split(' ');
        if (routeMethod !== method || !routePath.includes(':')) {
          continue;
        }
        const names = [];
        const pattern = new RegExp(
          `^${routePath.replace(/:([A-Za-z]+)/g, (m, name) => {
            names.push(name);
            return '([^/]+)';
          })}$`,
        );
        const found = pattern.exec(pathname);
        if (found) {
          handler = routeHandler;
          params = Object.fromEntries(
            names.map((name, i) => [name, decodeURIComponent(found[i + 1])]),
          );
          break;
        }
      }
    }
    if (!handler) {
      throw new Error(`no route for ${key}`);
    }
    const out = await handler(body, init.headers, { params, query });
    if (out instanceof Error) {
      throw out;
    }
    const [status, json, headers = {}] = out;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: name => headers[name] ?? null },
      json: async () => {
        if (json === undefined) {
          throw new Error('no body');
        }
        return json;
      },
    };
  });
  return calls;
};
