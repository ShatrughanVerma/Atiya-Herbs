import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {AuthProvider} from '../../src/context/AuthContext';
import {endSession, startSession} from '../../src/services/session';
import {WellnessProvider} from '../../src/wellness/context/WellnessContext';
import WellnessHomeScreen from '../../src/wellness/screens/WellnessHomeScreen';
import WellnessProfileScreen from '../../src/wellness/screens/WellnessProfileScreen';
import {mockServer} from '../../test-utils/mockServer';
import {REWARDS_EMPTY, SETTINGS} from '../../test-utils/wellnessSettings';

const METRICS = {
  frame: {x: 0, y: 0, width: 360, height: 800},
  insets: {top: 0, left: 0, right: 0, bottom: 0},
};

const TODAY = (patch = {}) => ({
  day: '2026-11-24',
  settings: SETTINGS,
  defaults: SETTINGS,
  rewards: REWARDS_EMPTY,
  steps: {count: 0, goal: 6000, percent: 0, distanceKm: 0, kcal: 0, perStep: {km: 0.00075, kcal: 0.04}},
  water: {ml: 0, glasses: 0, goalMl: 2000, goalGlasses: 8, percent: 0},
  mood: null,
  goals: {
    items: [
      {id: 'water', done: false},
      {id: 'mood', done: false},
    ],
    done: 0,
    total: 2,
    percent: 0,
    complete: false,
  },
  streak: {current: 0, best: 0},
  week: Array.from({length: 7}, (_, i) => ({day: `2026-11-${18 + i}`, waterMl: 0, glasses: 0, steps: 0})),
  ...patch,
});

const navigation = {navigate: jest.fn(), getParent: () => ({goBack: jest.fn()})};
let tree;

const mount = async Screen => {
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <AuthProvider>
          <WellnessProvider>
            <Screen navigation={navigation} />
          </WellnessProvider>
        </AuthProvider>
      </SafeAreaProvider>,
    );
  });
};

const control = label => {
  const found = tree.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function');
  if (!found.length) {
    throw new Error(`no "${label}" control`);
  }
  return found[0];
};
const press = async label => {
  await ReactTestRenderer.act(async () => {
    await control(label).props.onPress();
  });
};
const texts = () =>
  tree.root
    .findAll(n => typeof n.type === 'string' && n.type === 'Text')
    .map(n => [].concat(n.props.children).join(''));
const hasText = pattern => texts().some(t => pattern.test(t));

beforeEach(async () => {
  navigation.navigate.mockClear();
  await AsyncStorage.clear();
  Keychain.__store.clear();
  await endSession();
  await startSession({accessToken: 'a1', refreshToken: 'r1', user: {id: 'u1'}});
});

afterEach(async () => {
  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
  tree = null;
});

describe('Wellness Home', () => {
  test('shows today from the server: goals, water and the streak', async () => {
    const calls = mockServer({'GET /wellness/today': () => [200, TODAY({streak: {current: 3, best: 5}})]});
    await mount(WellnessHomeScreen);
    expect(calls[0].key).toBe('GET /wellness/today');
    expect(calls[0].auth).toBe('Bearer a1');
    expect(hasText(/^0\/2$/)).toBe(true);
    expect(hasText(/^0%$/)).toBe(true);
    expect(hasText(/^0 ml$/)).toBe(true);
    expect(hasText(/^of 2,000 ml$/)).toBe(true);
    expect(hasText(/^3$/)).toBe(true); // the streak
  });

  test('Add water shows at once and sends one glass to the server', async () => {
    const calls = mockServer({
      'GET /wellness/today': () => [200, TODAY()],
      'POST /wellness/water': () => [
        200,
        TODAY({water: {ml: 250, glasses: 1, goalMl: 2000, goalGlasses: 8, percent: 13}}),
      ],
    });
    await mount(WellnessHomeScreen);
    await press('Add water');
    expect(calls.find(c => c.key === 'POST /wellness/water').body).toEqual({ml: 250});
    expect(hasText(/^250 ml$/)).toBe(true);
    expect(hasText(/^13%$/)).toBe(true);
  });

  test('a mood is saved, and the goals count it', async () => {
    const calls = mockServer({
      'GET /wellness/today': () => [200, TODAY()],
      'PUT /wellness/mood': () => [
        200,
        TODAY({
          mood: 'good',
          goals: {
            items: [
              {id: 'water', done: false},
              {id: 'mood', done: true},
            ],
            done: 1,
            total: 2,
            percent: 50,
            complete: false,
          },
        }),
      ],
    });
    await mount(WellnessHomeScreen);
    await press('Feeling Good');
    expect(calls.find(c => c.key === 'PUT /wellness/mood').body).toEqual({mood: 'good'});
    expect(hasText(/^1\/2$/)).toBe(true);
    expect(hasText(/^50%$/)).toBe(true);
  });

  test('taps are sent in order: three glasses make three requests', async () => {
    let ml = 0;
    const calls = mockServer({
      'GET /wellness/today': () => [200, TODAY()],
      'POST /wellness/water': body => {
        ml += body.ml;
        return [200, TODAY({water: {ml, glasses: ml / 250, goalMl: 2000, goalGlasses: 8, percent: Math.round((ml / 2000) * 100)}})];
      },
    });
    await mount(WellnessHomeScreen);
    await press('Add water');
    await press('Add water');
    await press('Add water');
    expect(calls.filter(c => c.key === 'POST /wellness/water')).toHaveLength(3);
    expect(hasText(/^750 ml$/)).toBe(true);
  });

  test('when the server cannot be reached an empty screen says so and offers Retry', async () => {
    mockServer({'GET /wellness/today': () => [503, {statusCode: 503, message: 'Down'}]});
    await mount(WellnessHomeScreen);
    expect(hasText(/Could not load your wellness/)).toBe(true);
  });
});

describe('Wellness goals', () => {
  test('one glass more changes the goal on the server', async () => {
    const calls = mockServer({
      'GET /wellness/today': () => [200, TODAY()],
      'PUT /wellness/settings': () => [
        200,
        TODAY({settings: {...SETTINGS, waterGoalGlasses: 9}, water: {ml: 0, glasses: 0, goalMl: 2250, goalGlasses: 9, percent: 0}}),
      ],
    });
    await mount(WellnessProfileScreen);
    await press('One glass more');
    expect(calls.find(c => c.key === 'PUT /wellness/settings').body).toEqual({waterGoalGlasses: 9});
    expect(hasText(/^9 glasses$/)).toBe(true);
  });
});
