import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {AuthProvider, useAuth} from '../../src/context/AuthContext';
import LoginScreen from '../../src/screens/auth/LoginScreen';
import SignUpScreen from '../../src/screens/auth/SignUpScreen';
import {endSession, setSessionExpiredHandler} from '../../src/services/session';
import {loadTokens} from '../../src/services/tokenStore';
import {mockServer} from '../../test-utils/mockServer';

jest.mock('../../src/utils/googleAuth', () => ({
  isGoogleSignInConfigured: false,
  signInWithGoogle: jest.fn(),
  signOutFromGoogle: jest.fn(async () => {}),
}));

const METRICS = {
  frame: {x: 0, y: 0, width: 360, height: 800},
  insets: {top: 0, left: 0, right: 0, bottom: 0},
};
const SESSION = (user = {}) => ({
  accessToken: 'a1',
  refreshToken: 'r1',
  tokenType: 'Bearer',
  expiresInSeconds: 900,
  user: {id: 'u1', mobile: '9876543210', name: 'Asha Khan', email: 'asha@b.co', role: 'customer', ...user},
});

let tree;
let auth;
const navigation = {replace: jest.fn(), navigate: jest.fn()};

const Probe = () => {
  auth = useAuth();
  return null;
};

const mount = async Screen => {
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <AuthProvider>
          <Probe />
          <Screen navigation={navigation} />
        </AuthProvider>
      </SafeAreaProvider>,
    );
  });
};

// controls are found by their accessibility label (the same text a screen reader says)
const control = (label, prop) => {
  const found = tree.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props[prop] === 'function');
  if (!found.length) {
    throw new Error(`no "${label}" control`);
  }
  return found[0];
};
const type = async (label, text) => {
  await ReactTestRenderer.act(async () => {
    control(label, 'onChangeText').props.onChangeText(text);
  });
};
const press = async label => {
  await ReactTestRenderer.act(async () => {
    await control(label, 'onPress').props.onPress();
  });
};
const texts = () =>
  tree.root
    .findAll(n => typeof n.type === 'string' && n.type === 'Text')
    .map(n => [].concat(n.props.children).join(''));
const hasText = pattern => texts().some(t => pattern.test(t));

beforeEach(async () => {
  navigation.replace.mockClear();
  await AsyncStorage.clear();
  Keychain.__store.clear();
  setSessionExpiredHandler(null);
  await endSession();
});

afterEach(async () => {
  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
  tree = null;
});

describe('Login', () => {
  test('empty boxes are stopped before the server is called', async () => {
    const calls = mockServer({});
    await mount(LoginScreen);
    await press('Log in');
    expect(hasText(/Enter your email or mobile number/)).toBe(true);
    expect(hasText(/Enter your password/)).toBe(true);
    expect(calls).toHaveLength(0);
  });

  test('email and password: tokens go to the Keystore, the profile is saved, Main opens, the password is not kept', async () => {
    const calls = mockServer({'POST /auth/login': () => [200, SESSION()]});
    await mount(LoginScreen);
    await type('Email or mobile number', ' asha@b.co ');
    await type('Password', 'Herbal-Tea-42');
    await press('Log in');
    expect(calls[0].body).toMatchObject({identifier: 'asha@b.co', password: 'Herbal-Tea-42'});
    expect(await loadTokens()).toEqual({accessToken: 'a1', refreshToken: 'r1'});
    expect(auth.user).toMatchObject({name: 'Asha Khan', email: 'asha@b.co', mobile: '9876543210', provider: 'password', role: 'customer'});
    expect(navigation.replace).toHaveBeenCalledWith('Main');
    const saved = await AsyncStorage.getItem('atiya.session.v1');
    expect(saved).not.toMatch(/a1|r1|Herbal-Tea-42/);
  });

  test('a mobile number works the same way', async () => {
    const calls = mockServer({'POST /auth/login': () => [200, SESSION()]});
    await mount(LoginScreen);
    await type('Email or mobile number', '+91 98765 43210');
    await type('Password', 'Herbal-Tea-42');
    await press('Log in');
    expect(calls[0].body.identifier).toBe('+91 98765 43210'); // the server understands every format
    expect(navigation.replace).toHaveBeenCalledWith('Main');
  });

  test('wrong login details: the server\'s message is shown and nobody is logged in', async () => {
    mockServer({'POST /auth/login': () => [401, {statusCode: 401, message: 'Wrong login details.'}]});
    await mount(LoginScreen);
    await type('Email or mobile number', 'asha@b.co');
    await type('Password', 'Wrong-Pass-9');
    await press('Log in');
    expect(hasText(/Wrong login details/)).toBe(true);
    expect(auth.user).toBeNull();
    expect(await loadTokens()).toBeNull();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  test('a locked account says how long to wait, and no internet is explained', async () => {
    mockServer({'POST /auth/login': () => [429, {statusCode: 429, message: 'Wrong login details.'}, {'Retry-After': '840'}]});
    await mount(LoginScreen);
    await type('Email or mobile number', 'asha@b.co');
    await type('Password', 'Wrong-Pass-9');
    await press('Log in');
    expect(hasText(/try again in 14 minutes/)).toBe(true);

    global.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    await press('Log in');
    expect(hasText(/check your internet/)).toBe(true);
  });

  test('the password can be shown and hidden', async () => {
    mockServer({});
    await mount(LoginScreen);
    expect(control('Password', 'onChangeText').props.secureTextEntry).toBe(true);
    await press('Show password');
    expect(control('Password', 'onChangeText').props.secureTextEntry).toBe(false);
    await press('Hide password');
    expect(control('Password', 'onChangeText').props.secureTextEntry).toBe(true);
  });

  test('"Forgot password" explains it is coming soon, Apple and Google say "coming soon", and guests can carry on', async () => {
    const {Alert} = require('react-native');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockServer({});
    await mount(LoginScreen);
    await ReactTestRenderer.act(async () => {
      tree.root.findAll(n => typeof n.props.onPress === 'function' && n.props.accessibilityRole === 'button' && [].concat(n.props.children).some(c => c?.props?.children === 'Forgot Password?'))[0].props.onPress();
    });
    expect(alert).toHaveBeenLastCalledWith('Forgot password', expect.stringMatching(/coming soon/));
    await press('Log in with Apple');
    await press('Log in with Google');
    expect(alert).toHaveBeenCalledTimes(3);
    alert.mockRestore();
    await ReactTestRenderer.act(async () => {
      tree.root.findAll(n => typeof n.props.onPress === 'function' && n.props.children && [].concat(n.props.children).some(c => c?.props?.children === 'Continue as guest'))[0].props.onPress();
    });
    expect(navigation.replace).toHaveBeenCalledWith('Main');
  });
});

describe('Sign up', () => {
  const fill = async (overrides = {}) => {
    const values = {name: 'Asha Khan', email: 'asha@b.co', mobile: '98765 43210', password: 'Herbal-Tea-42', ...overrides};
    await type('Full name', values.name);
    await type('Email', values.email);
    await type('Mobile number', values.mobile);
    await type('Create a password', values.password);
  };

  test('every box is checked on the phone first, the password rules included', async () => {
    const calls = mockServer({});
    await mount(SignUpScreen);
    await press('Create account');
    expect(hasText(/full name/)).toBe(true);
    expect(hasText(/valid email/)).toBe(true);
    expect(hasText(/valid 10-digit mobile number/)).toBe(true);
    expect(hasText(/at least 8 characters/)).toBe(true);
    await fill({password: 'onlyletters'});
    await press('Create account');
    expect(hasText(/one letter and one number/)).toBe(true);
    expect(calls).toHaveLength(0);
  });

  test('shows the password rule as a hint under the box', async () => {
    mockServer({});
    await mount(SignUpScreen);
    expect(hasText(/At least 8 characters, with a letter and a number/)).toBe(true);
  });

  test('a new account is made on the server (name, email, plain 10-digit mobile, password) and the app opens', async () => {
    const calls = mockServer({'POST /auth/register': () => [201, SESSION()]});
    await mount(SignUpScreen);
    await fill();
    await press('Create account');
    expect(calls[0].body).toMatchObject({name: 'Asha Khan', email: 'asha@b.co', mobile: '9876543210', password: 'Herbal-Tea-42'});
    expect(await loadTokens()).toEqual({accessToken: 'a1', refreshToken: 'r1'});
    expect(auth.user).toMatchObject({name: 'Asha Khan', mobile: '9876543210', provider: 'password'});
    expect(navigation.replace).toHaveBeenCalledWith('Main');
    expect(await AsyncStorage.getItem('atiya.session.v1')).not.toMatch(/Herbal-Tea-42/);
  });

  test('a mobile or email that is already registered is shown under its own box', async () => {
    let message = 'This mobile number is already registered. Please log in.';
    mockServer({'POST /auth/register': () => [409, {statusCode: 409, message}]});
    await mount(SignUpScreen);
    await fill();
    await press('Create account');
    expect(hasText(/mobile number is already registered/)).toBe(true);
    expect(auth.user).toBeNull();

    message = 'This email is already registered. Please log in.';
    await press('Create account');
    expect(hasText(/email is already registered/)).toBe(true);
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  test('the server\'s complaint about a box (a common password) is shown under that box', async () => {
    mockServer({
      'POST /auth/register': () => [400, {statusCode: 400, message: 'Some details are not valid.', details: [{field: 'password', message: 'This password is too common. Please choose another one.'}]}],
    });
    await mount(SignUpScreen);
    await fill({password: 'Password123'});
    await press('Create account');
    expect(hasText(/too common/)).toBe(true);
    expect(auth.user).toBeNull();
  });
});
