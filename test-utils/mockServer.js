/* eslint-env jest */
import { client } from '../src/services/http';

// A fake server (it replaces the axios adapter of the app's client, so nothing goes to the network): routes is {'METHOD /path': (body, headers) => [status, json]}; every call is recorded
export const mockServer = routes => {
  const calls = [];
  const adapter = jest.fn(async config => {
    const url = config.url;
    const init = { method: (config.method || 'get').toUpperCase(), body: config.data, headers: config.headers };
    const path = url.replace(/^https?:\/\/[^/]+\/api\/v1/, '');
    const method = init.method;
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
      data: json,
      status,
      statusText: '',
      headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
      config,
    };
  });
  client.defaults.adapter = adapter;
  return calls;
};

// No connection at all (or a server that never answers, with code 'ECONNABORTED'): the adapter fails like axios does
export const mockNetworkFailure = (code = 'ERR_NETWORK') => {
  const adapter = jest.fn(async () => {
    throw Object.assign(new Error('Network Error'), { code });
  });
  client.defaults.adapter = adapter;
  return adapter;
};
