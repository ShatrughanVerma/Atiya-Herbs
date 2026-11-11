import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import {AuthProvider, useAuth} from '../src/context/AuthContext';
import {endSession, setSessionExpiredHandler} from '../src/services/session';
import {loadTokens, saveTokens} from '../src/services/tokenStore';
import {mockNetworkFailure, mockServer} from '../test-utils/mockServer';

const mockSignOutFromGoogle = jest.fn(async () => {});
jest.mock('../src/utils/googleAuth', () => ({
  signOutFromGoogle: (...args) => mockSignOutFromGoogle(...args),
}));

const KEY = 'atiya.session.v1';
const ME = {id: 'u1', mobile: '9876543210', name: 'Asha Khan', email: 'asha@b.co', role: 'customer'};
const ACCOUNT_PROFILE = {name: 'Asha', email: '', mobile: '9876543210', provider: 'password'};

const mount = async () => {
  let auth;
  const Probe = () => {
    auth = useAuth();
    return null;
  };
  await ReactTestRenderer.act(async () => {
    ReactTestRenderer.create(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
  });
  return () => auth;
};

let fetchCalls;
beforeEach(async () => {
  await AsyncStorage.clear();
  Keychain.__store.clear();
  setSessionExpiredHandler(null);
  await endSession();
  mockSignOutFromGoogle.mockClear();
  fetchCalls = mockNetworkFailure(); // offline unless a test sets a server
});

test('starts signed out when nothing was saved', async () => {
  const get = await mount();
  expect(get().ready).toBe(true);
  expect(get().user).toBeNull();
});

test('a local sign-in (Google) is remembered, and only the profile is stored', async () => {
  const get = await mount();
  await ReactTestRenderer.act(async () => {
    get().signIn({name: 'Asha', email: 'a@b.co', provider: 'google', password: 'Herbs1234', token: 'secret'});
  });
  const saved = JSON.parse(await AsyncStorage.getItem(KEY));
  expect(saved).toEqual({name: 'Asha', email: 'a@b.co', provider: 'google'});
  expect(JSON.stringify(saved)).not.toMatch(/Herbs1234|secret/);
});

test('a Google login is restored without any backend token, and the server is never called', async () => {
  await AsyncStorage.setItem(KEY, JSON.stringify({name: 'Bilal', email: 'b@b.co', provider: 'google'}));
  const get = await mount();
  expect(get().user).toEqual({name: 'Bilal', email: 'b@b.co', provider: 'google'});
  expect(fetchCalls).not.toHaveBeenCalled();
});

describe('Account login', () => {
  test('after a login the profile is saved and the tokens stay out of AsyncStorage', async () => {
    const get = await mount();
    await ReactTestRenderer.act(async () => {
      get().completeLogin(ME);
    });
    expect(get().user).toEqual({name: 'Asha Khan', email: 'asha@b.co', mobile: '9876543210', role: 'customer', provider: 'password'});
    const saved = await AsyncStorage.getItem(KEY);
    expect(JSON.parse(saved).mobile).toBe('9876543210');
    expect(saved).not.toMatch(/accessToken|refreshToken|"a1"|"r1"/);
  });

  test('a saved login is restored, and the name and email are refreshed from the server', async () => {
    await saveTokens({accessToken: 'a1', refreshToken: 'r1'});
    await AsyncStorage.setItem(KEY, JSON.stringify({...ACCOUNT_PROFILE, photo: 'file:///me.jpg', gender: 'Male'}));
    mockServer({'GET /users/me': () => [200, ME]});
    const get = await mount();
    expect(get().ready).toBe(true);
    // the server's answer replaced the old name; the photo and gender (only on this phone) stayed
    expect(get().user).toEqual({
      name: 'Asha Khan',
      email: 'asha@b.co',
      mobile: '9876543210',
      role: 'customer',
      provider: 'password',
      photo: 'file:///me.jpg',
      gender: 'Male',
    });
  });

  test('a phone that saved the account as "otp" (an earlier build) keeps working as a server account', async () => {
    await saveTokens({accessToken: 'a1', refreshToken: 'r1'});
    await AsyncStorage.setItem(KEY, JSON.stringify({...ACCOUNT_PROFILE, provider: 'otp'}));
    mockServer({'GET /users/me': () => [200, ME]});
    const get = await mount();
    expect(get().user.provider).toBe('password'); // refreshed from the server
  });

  test('offline at start keeps the saved profile and the login', async () => {
    await saveTokens({accessToken: 'a1', refreshToken: 'r1'});
    await AsyncStorage.setItem(KEY, JSON.stringify(ACCOUNT_PROFILE));
    const get = await mount();
    expect(get().user).toEqual(ACCOUNT_PROFILE);
    expect(await loadTokens()).not.toBeNull();
  });

  test('a profile whose tokens are gone (Keystore wiped) is signed out', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify(ACCOUNT_PROFILE));
    const get = await mount();
    expect(get().user).toBeNull();
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });

  test('the old fake email login (no backend session) has to log in again with a password', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify({name: 'Old', email: 'o@b.co', provider: 'email'}));
    const get = await mount();
    expect(get().user).toBeNull();
  });

  test('tokens without a saved profile (closed in the middle of sign-up) are recovered from the server, or dropped when no name was given', async () => {
    await saveTokens({accessToken: 'a1', refreshToken: 'r1'});
    mockServer({'GET /users/me': () => [200, ME]});
    let get = await mount();
    expect(get().user.name).toBe('Asha Khan');

    await AsyncStorage.clear();
    await saveTokens({accessToken: 'a1', refreshToken: 'r1'});
    mockServer({'GET /users/me': () => [200, {...ME, name: null}]});
    get = await mount();
    expect(get().user).toBeNull();
    expect(await loadTokens()).toBeNull();
  });

  test('when the server ends the login the app signs out by itself', async () => {
    await saveTokens({accessToken: 'a1', refreshToken: 'r1'});
    await AsyncStorage.setItem(KEY, JSON.stringify(ACCOUNT_PROFILE));
    mockServer({
      'GET /users/me': () => [401, {message: 'expired'}],
      'POST /auth/refresh': () => [401, {message: 'Your session has expired. Please log in again.'}],
    });
    const get = await mount();
    expect(get().user).toBeNull();
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
    expect(await loadTokens()).toBeNull();
  });

  test('logging out ends the login on the server and forgets everything on the phone', async () => {
    await saveTokens({accessToken: 'a1', refreshToken: 'r1'});
    await AsyncStorage.setItem(KEY, JSON.stringify(ACCOUNT_PROFILE));
    const calls = mockServer({
      'GET /users/me': () => [200, ME],
      'POST /auth/logout': () => [204, undefined],
    });
    const get = await mount();
    await ReactTestRenderer.act(async () => {
      await get().signOut();
    });
    expect(calls.find(c => c.key === 'POST /auth/logout').body).toEqual({refreshToken: 'r1'});
    expect(get().user).toBeNull();
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
    expect(await loadTokens()).toBeNull();
  });

  test('logging out works offline too', async () => {
    await saveTokens({accessToken: 'a1', refreshToken: 'r1'});
    await AsyncStorage.setItem(KEY, JSON.stringify(ACCOUNT_PROFILE));
    const get = await mount();
    await ReactTestRenderer.act(async () => {
      await get().signOut();
    });
    expect(get().user).toBeNull();
    expect(await loadTokens()).toBeNull();
  });

  test('saving the profile sends only name and email, and the screen follows the server\'s answer', async () => {
    await saveTokens({accessToken: 'a1', refreshToken: 'r1'});
    await AsyncStorage.setItem(KEY, JSON.stringify(ACCOUNT_PROFILE));
    const calls = mockServer({
      'GET /users/me': () => [200, ME],
      'PATCH /users/me': body => [200, {...ME, ...body}],
    });
    const get = await mount();
    await ReactTestRenderer.act(async () => {
      await get().updateProfile({name: 'Asha K'});
    });
    expect(calls.find(c => c.key === 'PATCH /users/me').body).toEqual({name: 'Asha K'});
    expect(get().user.name).toBe('Asha K');
  });

  test('deleting the account removes it on the server, then everything on the phone', async () => {
    await saveTokens({accessToken: 'a1', refreshToken: 'r1'});
    await AsyncStorage.setItem(KEY, JSON.stringify(ACCOUNT_PROFILE));
    const calls = mockServer({
      'GET /users/me': () => [200, ME],
      'DELETE /users/me': () => [204, undefined],
    });
    const get = await mount();
    await ReactTestRenderer.act(async () => {
      await get().deleteAccount();
    });
    expect(calls.some(c => c.key === 'DELETE /users/me')).toBe(true);
    expect(get().user).toBeNull();
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
    expect(await loadTokens()).toBeNull();
  });

  test('an account with an order on its way is NOT deleted, and the person stays logged in', async () => {
    await saveTokens({accessToken: 'a1', refreshToken: 'r1'});
    await AsyncStorage.setItem(KEY, JSON.stringify(ACCOUNT_PROFILE));
    mockServer({
      'GET /users/me': () => [200, ME],
      'DELETE /users/me': () => [409, {statusCode: 409, message: 'You have an order on its way. Please wait until it is delivered or cancel it, then delete your account.'}],
    });
    const get = await mount();
    let error;
    await ReactTestRenderer.act(async () => {
      error = await get().deleteAccount().catch(e => e);
    });
    expect(error.kind).toBe('conflict');
    expect(error.message).toMatch(/order on its way/);
    expect(get().user).not.toBeNull();
    expect(await loadTokens()).not.toBeNull();
  });
});

test('logging out of a Google account also signs out of Google', async () => {
  await AsyncStorage.setItem(KEY, JSON.stringify({name: 'Bilal', provider: 'google'}));
  const get = await mount();
  await ReactTestRenderer.act(async () => {
    await get().signOut();
  });
  expect(mockSignOutFromGoogle).toHaveBeenCalled();
  expect(get().user).toBeNull();
  expect(await AsyncStorage.getItem(KEY)).toBeNull();
});

test('damaged saved data is ignored instead of crashing the app', async () => {
  for (const bad of ['{not json', '"text"', '{"email":"x@y.co"}', 'null']) {
    await AsyncStorage.setItem(KEY, bad);
    const get = await mount();
    expect(get().ready).toBe(true);
    expect(get().user).toBeNull();
  }
});
