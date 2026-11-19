import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {AuthProvider, useAuth} from '../../src/context/AuthContext';
import LoginScreen from '../../src/screens/auth/LoginScreen';
import {signInWithGoogle} from '../../src/utils/googleAuth';
import {endSession, setSessionExpiredHandler} from '../../src/services/session';
import {loadTokens} from '../../src/services/tokenStore';
import {mockServer} from '../../test-utils/mockServer';

jest.mock('../../src/utils/googleAuth', () => ({
  isGoogleSignInConfigured: true,
  signInWithGoogle: jest.fn(),
  signOutFromGoogle: jest.fn(async () => {}),
}));

const METRICS = {
  frame: {x: 0, y: 0, width: 360, height: 800},
  insets: {top: 0, left: 0, right: 0, bottom: 0},
};
const SESSION = {
  accessToken: 'a1',
  refreshToken: 'r1',
  tokenType: 'Bearer',
  expiresInSeconds: 900,
  user: {id: 'u1', mobile: '9876543210', name: 'Asha Khan', email: 'asha@b.co', role: 'customer'},
};
const GOOGLE_RESULT = {user: {name: 'Asha Khan', email: 'asha@b.co', provider: 'google'}, idToken: 'google-id-token-google-id-token'};

let tree;
let auth;
const navigation = {replace: jest.fn(), navigate: jest.fn(), goBack: jest.fn()};
const Probe = () => {
  auth = useAuth();
  return null;
};

const mount = async () => {
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <AuthProvider>
          <Probe />
          <LoginScreen navigation={navigation} />
        </AuthProvider>
      </SafeAreaProvider>,
    );
  });
};
const control = (label, prop) => {
  const found = tree.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props[prop] === 'function');
  if (!found.length) {
    throw new Error(`no "${label}" control`);
  }
  return found[0];
};
const press = async label => {
  await ReactTestRenderer.act(async () => {
    await control(label, 'onPress').props.onPress();
  });
};
const pressContinue = async () => {
  const button = tree.root.findAll(n => n.props.onPress && n.props.accessibilityRole === 'button' && n.props.disabled !== undefined && !n.props.accessibilityLabel)[0];
  await ReactTestRenderer.act(async () => {
    await button.props.onPress();
  });
};
const typeMobile = async text => {
  const input = tree.root.findAll(n => n.props.placeholder === '10-digit mobile number' && typeof n.props.onChangeText === 'function')[0];
  await ReactTestRenderer.act(async () => {
    input.props.onChangeText(text);
  });
};
const texts = () =>
  tree.root
    .findAll(n => typeof n.type === 'string' && n.type === 'Text')
    .map(n => [].concat(n.props.children).join(''));
const hasText = pattern => texts().some(t => pattern.test(t));

beforeEach(async () => {
  navigation.replace.mockClear();
  signInWithGoogle.mockReset();
  signInWithGoogle.mockResolvedValue(GOOGLE_RESULT);
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

describe('Continue with Google', () => {
  test('a person who already has an account is logged in with the backend session', async () => {
    const calls = mockServer({'POST /auth/google': () => [200, SESSION]});
    await mount();
    await press('Log in with Google');
    expect(calls[0].body).toEqual({idToken: GOOGLE_RESULT.idToken});
    expect(await loadTokens()).toEqual({accessToken: 'a1', refreshToken: 'r1'});
    expect(auth.user).toMatchObject({email: 'asha@b.co', mobile: '9876543210', provider: 'password'});
    expect(navigation.replace).toHaveBeenCalledWith('Main');
  });

  test('a new person is asked for a mobile number, which creates the account', async () => {
    const calls = mockServer({
      'POST /auth/google': body =>
        body.mobile ? [200, SESSION] : [200, {needsMobile: true, otpRequired: false, name: 'Asha Khan', email: 'asha@b.co'}],
    });
    await mount();
    await press('Log in with Google');
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(hasText(/One last step/)).toBe(true);

    await typeMobile('12345');
    await pressContinue();
    expect(hasText(/valid 10-digit mobile number/)).toBe(true);
    expect(calls).toHaveLength(1); // a wrong number is stopped before the server is called

    await typeMobile('+91 98765 43210');
    await pressContinue();
    expect(calls[1].body).toEqual({idToken: GOOGLE_RESULT.idToken, mobile: '9876543210'});
    expect(await loadTokens()).toEqual({accessToken: 'a1', refreshToken: 'r1'});
    expect(navigation.replace).toHaveBeenCalledWith('Main');
  });

  test('closing the Google picker does nothing', async () => {
    signInWithGoogle.mockResolvedValue(null);
    const calls = mockServer({});
    await mount();
    await press('Log in with Google');
    expect(calls).toHaveLength(0);
    expect(auth.user).toBeNull();
  });

  test('the server refusing the token shows its message and logs nobody in', async () => {
    mockServer({'POST /auth/google': () => [401, {statusCode: 401, message: 'Google sign-in failed. Please try again.'}]});
    const alert = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
    await mount();
    await press('Log in with Google');
    expect(alert).toHaveBeenCalledWith('Google sign-in', expect.stringMatching(/Google sign-in failed/));
    expect(auth.user).toBeNull();
    expect(navigation.replace).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});
