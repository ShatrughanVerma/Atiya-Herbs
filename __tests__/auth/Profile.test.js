import React from 'react';
import {Alert} from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {AuthProvider, useAuth} from '../../src/context/AuthContext';
import {CartProvider} from '../../src/context/CartContext';
import {CatalogProvider} from '../../src/context/CatalogContext';
import EditProfileScreen from '../../src/screens/EditProfileScreen';
import ProfileScreen from '../../src/screens/ProfileScreen';
import {endSession, setSessionExpiredHandler} from '../../src/services/session';
import {loadTokens, saveTokens} from '../../src/services/tokenStore';
import {mockServer} from '../../test-utils/mockServer';

jest.mock('../../src/utils/googleAuth', () => ({
  signOutFromGoogle: jest.fn(async () => {}),
}));

const METRICS = {
  frame: {x: 0, y: 0, width: 360, height: 800},
  insets: {top: 0, left: 0, right: 0, bottom: 0},
};
const ME = {id: 'u1', mobile: '9876543210', name: 'Asha Khan', email: 'asha@b.co', role: 'customer'};
const PROFILE = {name: 'Asha Khan', email: 'asha@b.co', mobile: '9876543210', provider: 'password', role: 'customer'};
const navigation = {navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true};

let tree;
let auth;
// Like the app, a screen is shown only once the saved login has been read (the splash screen waits for it)
const Gate = ({Screen}) => {
  auth = useAuth();
  return auth.ready ? <Screen navigation={navigation} /> : null;
};
const mount = async Screen => {
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <AuthProvider>
          <CatalogProvider>
            <CartProvider>
              <Gate Screen={Screen} />
            </CartProvider>
          </CatalogProvider>
        </AuthProvider>
      </SafeAreaProvider>,
    );
  });
};
const texts = () =>
  tree.root
    .findAll(n => typeof n.type === 'string' && n.type === 'Text')
    .map(n => [].concat(n.props.children).join(''));
const hasText = pattern => texts().some(t => pattern.test(t));
const pressRow = async label => {
  const row = tree.root.findAll(
    n =>
      typeof n.props.onPress === 'function' &&
      n.findAll(c => typeof c.type === 'string' && c.type === 'Text' && [].concat(c.props.children).join('') === label)
        .length > 0,
  );
  await ReactTestRenderer.act(async () => {
    row[row.length - 1].props.onPress();
  });
};

beforeEach(async () => {
  navigation.goBack.mockClear();
  await AsyncStorage.clear();
  Keychain.__store.clear();
  setSessionExpiredHandler(null);
  await endSession();
  await saveTokens({accessToken: 'a1', refreshToken: 'r1'});
  await AsyncStorage.setItem('atiya.session.v1', JSON.stringify(PROFILE));
});

afterEach(async () => {
  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
  tree = null;
  jest.restoreAllMocks();
});

describe('Edit profile', () => {
  test('the mobile number is locked, and only a changed name goes to the server', async () => {
    const calls = mockServer({
      'GET /users/me': () => [200, ME],
      'PATCH /users/me': body => [200, {...ME, ...body}],
    });
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await mount(EditProfileScreen);
    const mobile = tree.root.findAll(n => /^Mobile number 98765 43210|^Mobile number \+91/.test(n.props.accessibilityLabel || '') && 'editable' in n.props)[0];
    expect(mobile.props.editable).toBe(false);
    expect(hasText(/cannot be changed here/)).toBe(true);

    await ReactTestRenderer.act(async () => {
      tree.root.findAll(n => n.props.placeholder === 'Full name')[0].props.onChangeText('Asha K');
    });
    await ReactTestRenderer.act(async () => {
      await tree.root.findAll(n => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function' && n.props.disabled === false)[0].props.onPress();
    });
    const patch = calls.find(c => c.key === 'PATCH /users/me');
    expect(patch.body).toEqual({name: 'Asha K'}); // email and mobile did not change, so they are not sent
    expect(auth.user.name).toBe('Asha K');
    expect(navigation.goBack).toHaveBeenCalled();
  });

  test('the server\'s complaint about a box is shown under that box and nothing is saved', async () => {
    mockServer({
      'GET /users/me': () => [200, ME],
      'PATCH /users/me': () => [400, {statusCode: 400, message: 'Some details are not valid.', details: [{field: 'email', message: 'Invalid email address'}]}],
    });
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await mount(EditProfileScreen);
    await ReactTestRenderer.act(async () => {
      tree.root.findAll(n => n.props.placeholder === 'Email')[0].props.onChangeText('x@y.co');
    });
    await ReactTestRenderer.act(async () => {
      await tree.root.findAll(n => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function' && n.props.disabled === false)[0]?.props.onPress();
    });
    expect(hasText(/Invalid email address/)).toBe(true);
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(auth.user.email).toBe('asha@b.co');
  });
});

describe('Edit profile: email and password', () => {
  const saveButton = () =>
    tree.root.findAll(n => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function' && n.props.disabled === false)[0];
  const typeInto = async (label, text) => {
    await ReactTestRenderer.act(async () => {
      tree.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onChangeText === 'function')[0].props.onChangeText(text);
    });
  };
  const pressLabel = async label => {
    await ReactTestRenderer.act(async () => {
      await tree.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0].props.onPress();
    });
  };

  test('an email that belongs to another account is shown under the email box', async () => {
    mockServer({
      'GET /users/me': () => [200, ME],
      'PATCH /users/me': () => [409, {statusCode: 409, message: 'This email is already used by another account.'}],
    });
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await mount(EditProfileScreen);
    await ReactTestRenderer.act(async () => {
      tree.root.findAll(n => n.props.placeholder === 'Email')[0].props.onChangeText('taken@y.co');
    });
    await ReactTestRenderer.act(async () => {
      await saveButton().props.onPress();
    });
    expect(hasText(/already used by another account/)).toBe(true);
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  test('change password: checked on the phone, sent to the server, and the new session replaces the old tokens', async () => {
    const calls = mockServer({
      'GET /users/me': () => [200, ME],
      'POST /users/me/password': () => [200, {accessToken: 'a2', refreshToken: 'r2', tokenType: 'Bearer', expiresInSeconds: 900, user: ME}],
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await mount(EditProfileScreen);
    await pressLabel('Change password');

    await pressLabel('Update password'); // empty boxes: stopped on the phone
    expect(hasText(/Enter your current password/)).toBe(true);
    expect(calls.some(c => c.key === 'POST /users/me/password')).toBe(false);
    await typeInto('Current password', 'Old-Pass-123');
    await typeInto('New password', 'short');
    await pressLabel('Update password');
    expect(hasText(/at least 8 characters/)).toBe(true);

    await typeInto('New password', 'Brand-New-Pass-7');
    await pressLabel('Update password');
    const sent = calls.find(c => c.key === 'POST /users/me/password');
    expect(sent.body).toEqual({currentPassword: 'Old-Pass-123', newPassword: 'Brand-New-Pass-7'});
    expect(sent.auth).toBe('Bearer a1');
    expect(await loadTokens()).toEqual({accessToken: 'a2', refreshToken: 'r2'}); // this phone stays logged in
    expect(alert).toHaveBeenCalledWith('Password changed', expect.stringMatching(/Other phones/));
    expect(await AsyncStorage.getItem('atiya.session.v1')).not.toMatch(/Brand-New|Old-Pass/);
  });

  test('a wrong current password is shown under its box, and a lock says how long to wait', async () => {
    let answer = [400, {statusCode: 400, message: 'Some details are not valid.', details: [{field: 'currentPassword', message: 'The current password is not correct.'}]}];
    mockServer({'GET /users/me': () => [200, ME], 'POST /users/me/password': () => answer});
    await mount(EditProfileScreen);
    await pressLabel('Change password');
    await typeInto('Current password', 'Wrong-Pass-9');
    await typeInto('New password', 'Brand-New-Pass-7');
    await pressLabel('Update password');
    expect(hasText(/current password is not correct/)).toBe(true);
    expect(await loadTokens()).toEqual({accessToken: 'a1', refreshToken: 'r1'}); // nothing changed

    answer = [429, {statusCode: 429, message: 'Too many wrong attempts. Please try again later.'}, {'Retry-After': '600'}];
    await pressLabel('Update password');
    expect(hasText(/try again in 10 minutes/)).toBe(true);
  });
});

describe('Delete my account', () => {
  test('is offered to accounts saved on the server, asks first, and then removes the account and the login', async () => {
    const calls = mockServer({
      'GET /users/me': () => [200, ME],
      'DELETE /users/me': () => [204, undefined],
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await mount(ProfileScreen);
    await pressRow('Delete my account');
    expect(alert).toHaveBeenCalledTimes(1);
    expect(calls.some(c => c.key === 'DELETE /users/me')).toBe(false); // nothing happens before the person confirms

    const buttons = alert.mock.calls[0][2];
    await ReactTestRenderer.act(async () => {
      await buttons.find(b => b.text === 'Delete').onPress();
    });
    expect(calls.some(c => c.key === 'DELETE /users/me')).toBe(true);
    expect(auth.user).toBeNull();
    expect(await loadTokens()).toBeNull();
  });

  test('an order on its way: the reason is shown and the account stays', async () => {
    mockServer({
      'GET /users/me': () => [200, ME],
      'DELETE /users/me': () => [409, {statusCode: 409, message: 'You have an order on its way. Please wait until it is delivered or cancel it, then delete your account.'}],
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await mount(ProfileScreen);
    await pressRow('Delete my account');
    await ReactTestRenderer.act(async () => {
      await alert.mock.calls[0][2].find(b => b.text === 'Delete').onPress();
    });
    expect(alert).toHaveBeenLastCalledWith('Delete my account', expect.stringMatching(/order on its way/));
    expect(auth.user).not.toBeNull();
  });

  test('is not shown to a guest or a Google account (no account on the server)', async () => {
    await AsyncStorage.setItem('atiya.session.v1', JSON.stringify({name: 'Bilal', provider: 'google'}));
    await endSession();
    mockServer({});
    await mount(ProfileScreen);
    expect(hasText(/Delete my account/)).toBe(false);
  });
});
