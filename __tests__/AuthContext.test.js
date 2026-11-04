import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {AuthProvider, useAuth} from '../src/context/AuthContext';

jest.mock('../src/utils/googleAuth', () => ({signOutFromGoogle: jest.fn(async () => {})}));

const KEY = 'atiya.session.v1';

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

beforeEach(async () => {
  await AsyncStorage.clear();
});

test('starts signed out when nothing was saved', async () => {
  const get = await mount();
  expect(get().ready).toBe(true);
  expect(get().user).toBeNull();
});

test('signing in is remembered, and only the profile is stored', async () => {
  const get = await mount();
  await ReactTestRenderer.act(async () => {
    get().signIn({name: 'Asha', email: 'a@b.co', provider: 'email', password: 'Herbs1234', token: 'secret'});
  });
  const saved = JSON.parse(await AsyncStorage.getItem(KEY));
  expect(saved).toEqual({name: 'Asha', email: 'a@b.co', provider: 'email'});
  expect(JSON.stringify(saved)).not.toMatch(/Herbs1234|secret/);
});

test('a saved login is restored the next time the app opens', async () => {
  await AsyncStorage.setItem(KEY, JSON.stringify({name: 'Bilal', email: 'b@b.co', mobile: '9876543210', provider: 'email'}));
  const get = await mount();
  expect(get().user).toEqual({name: 'Bilal', email: 'b@b.co', mobile: '9876543210', provider: 'email'});
});

test('logging out forgets the saved login', async () => {
  await AsyncStorage.setItem(KEY, JSON.stringify({name: 'Bilal', provider: 'email'}));
  const get = await mount();
  await ReactTestRenderer.act(async () => {
    await get().signOut();
  });
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
