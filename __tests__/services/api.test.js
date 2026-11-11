import * as Keychain from 'react-native-keychain';
import {ApiError, request} from '../../src/services/http';
import {
  authFetch,
  endSession,
  getRefreshToken,
  hasSession,
  restoreSession,
  setSessionExpiredHandler,
  startSession,
} from '../../src/services/session';
import {clearTokens, loadTokens, saveTokens} from '../../src/services/tokenStore';
import {mockNetworkFailure, mockServer} from '../../test-utils/mockServer';

beforeEach(async () => {
  Keychain.__store.clear();
  setSessionExpiredHandler(null);
  await endSession();
});

describe('token store', () => {
  test('saves both tokens in the Keystore (react-native-keychain) and reads them back', async () => {
    await saveTokens({accessToken: 'a1', refreshToken: 'r1'});
    expect(await loadTokens()).toEqual({accessToken: 'a1', refreshToken: 'r1'});
    expect(Keychain.setGenericPassword).toHaveBeenCalled();
    await clearTokens();
    expect(await loadTokens()).toBeNull();
  });

  test('damaged saved data counts as no login', async () => {
    await Keychain.setGenericPassword('tokens', '{not json', {service: 'atiya.auth.tokens.v1'});
    expect(await loadTokens()).toBeNull();
    await Keychain.setGenericPassword('tokens', JSON.stringify({accessToken: 1}), {
      service: 'atiya.auth.tokens.v1',
    });
    expect(await loadTokens()).toBeNull();
  });

  test('a Keystore that fails reads as no login instead of crashing the app', async () => {
    Keychain.getGenericPassword.mockRejectedValueOnce(new Error('keystore locked'));
    expect(await loadTokens()).toBeNull();
  });
});

describe('errors', () => {
  test('a validation answer carries the message per field', async () => {
    mockServer({
      'POST /auth/login': () => [
        400,
        {statusCode: 400, message: 'Some details are not valid.', details: [{field: 'email', message: 'Please enter a valid email.'}]},
      ],
    });
    const error = await request('/auth/login', {method: 'POST', body: {identifier: 'x', password: 'y'}}).catch(e => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe('validation');
    expect(error.fields.email).toMatch(/valid email/);
  });

  test('wrong code, too many tries, and the server being down each get their own kind and a friendly text', async () => {
    mockServer({
      'POST /a': () => [401, {statusCode: 401, message: 'The code is wrong or has expired.'}],
      'POST /b': () => [429, {statusCode: 429, message: 'Too many codes requested for this number. Please wait a few minutes.'}],
      'POST /c': () => [500, {statusCode: 500, message: 'Internal server error: SELECT * FROM users'}],
      'POST /d': () => [503, undefined],
    });
    const a = await request('/a', {method: 'POST', body: {}}).catch(e => e);
    expect([a.kind, a.message]).toEqual(['unauthorized', 'The code is wrong or has expired.']);
    const b = await request('/b', {method: 'POST', body: {}}).catch(e => e);
    expect([b.kind, b.status]).toEqual(['rate-limited', 429]);
    const c = await request('/c', {method: 'POST', body: {}}).catch(e => e);
    expect(c.kind).toBe('server');
    expect(c.message).not.toMatch(/SELECT/); // a server's inner message is never shown
    const d = await request('/d', {method: 'POST', body: {}}).catch(e => e);
    expect(d.kind).toBe('server');
  });

  test('no connection and a slow server are told apart', async () => {
    mockNetworkFailure();
    const offline = await request('/x').catch(e => e);
    expect(offline.kind).toBe('network');
    expect(offline.message).toMatch(/internet/);

    mockNetworkFailure('ECONNABORTED');
    const slow = await request('/x', {timeoutMs: 20}).catch(e => e);
    expect(slow.kind).toBe('timeout');
  });

  test('204 gives null, and only the token the caller passes is sent', async () => {
    const calls = mockServer({'DELETE /users/me': () => [204, undefined]});
    expect(await request('/users/me', {method: 'DELETE', token: 't1'})).toBeNull();
    expect(calls[0].auth).toBe('Bearer t1');
  });
});

describe('authFetch', () => {
  test('adds the access token', async () => {
    const calls = mockServer({'GET /users/me': () => [200, {id: 'u1'}]});
    await startSession({accessToken: 'a1', refreshToken: 'r1'});
    expect(await authFetch('/users/me')).toEqual({id: 'u1'});
    expect(calls[0].auth).toBe('Bearer a1');
  });

  test('without a login it fails at once, without calling the server', async () => {
    const calls = mockServer({});
    const error = await authFetch('/users/me').catch(e => e);
    expect(error.kind).toBe('unauthorized');
    expect(calls).toHaveLength(0);
  });

  test('an expired token is swapped once for a new pair and the call is repeated', async () => {
    const calls = mockServer({
      'GET /users/me': (body, headers) =>
        headers.Authorization === 'Bearer a2' ? [200, {id: 'u1'}] : [401, {message: 'expired'}],
      'POST /auth/refresh': () => [200, {accessToken: 'a2', refreshToken: 'r2', user: {}}],
    });
    await startSession({accessToken: 'a1', refreshToken: 'r1'});
    expect(await authFetch('/users/me')).toEqual({id: 'u1'});
    expect(calls.map(c => c.key)).toEqual(['GET /users/me', 'POST /auth/refresh', 'GET /users/me']);
    expect(calls[1].body).toEqual({refreshToken: 'r1'});
    // the new pair (the refresh token rotates) is saved in the Keystore
    expect(await loadTokens()).toEqual({accessToken: 'a2', refreshToken: 'r2'});
    expect(getRefreshToken()).toBe('r2');
  });

  test('calls that expire at the same moment share ONE refresh (a refresh token works only once)', async () => {
    let refreshes = 0;
    const calls = mockServer({
      'GET /a': (body, headers) => (headers.Authorization === 'Bearer a2' ? [200, {ok: 'a'}] : [401, {}]),
      'GET /b': (body, headers) => (headers.Authorization === 'Bearer a2' ? [200, {ok: 'b'}] : [401, {}]),
      'GET /c': (body, headers) => (headers.Authorization === 'Bearer a2' ? [200, {ok: 'c'}] : [401, {}]),
      'POST /auth/refresh': async () => {
        refreshes += 1;
        await new Promise(resolve => setTimeout(resolve, 20));
        return [200, {accessToken: 'a2', refreshToken: 'r2', user: {}}];
      },
    });
    await startSession({accessToken: 'a1', refreshToken: 'r1'});
    const results = await Promise.all([authFetch('/a'), authFetch('/b'), authFetch('/c')]);
    expect(results).toEqual([{ok: 'a'}, {ok: 'b'}, {ok: 'c'}]);
    expect(refreshes).toBe(1);
    expect(calls.filter(c => c.key === 'POST /auth/refresh')).toHaveLength(1);
  });

  test('when the refresh is refused (or its token was stolen and reused) the login ends and the app is told', async () => {
    const expired = jest.fn();
    setSessionExpiredHandler(expired);
    mockServer({
      'GET /users/me': () => [401, {message: 'expired'}],
      'POST /auth/refresh': () => [401, {message: 'Your session has expired. Please log in again.'}],
    });
    await startSession({accessToken: 'a1', refreshToken: 'r1'});
    const error = await authFetch('/users/me').catch(e => e);
    expect(error.kind).toBe('unauthorized');
    expect(expired).toHaveBeenCalledTimes(1);
    expect(hasSession()).toBe(false);
    expect(await loadTokens()).toBeNull();
  });

  test('being offline during a refresh does NOT log anyone out', async () => {
    const expired = jest.fn();
    setSessionExpiredHandler(expired);
    mockServer({
      'GET /users/me': () => [401, {}],
      'POST /auth/refresh': () => new TypeError('Network request failed'),
    });
    await startSession({accessToken: 'a1', refreshToken: 'r1'});
    const error = await authFetch('/users/me').catch(e => e);
    expect(error.kind).toBe('network');
    expect(expired).not.toHaveBeenCalled();
    expect(await loadTokens()).toEqual({accessToken: 'a1', refreshToken: 'r1'});
  });

  test('a login saved on the phone is found again when the app starts', async () => {
    await saveTokens({accessToken: 'a1', refreshToken: 'r1'});
    await restoreSession();
    expect(hasSession()).toBe(true);
    expect(getRefreshToken()).toBe('r1');
  });
});
