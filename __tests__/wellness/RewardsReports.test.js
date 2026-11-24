import React from 'react';
import {Alert} from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {AuthProvider} from '../../src/context/AuthContext';
import {endSession, startSession} from '../../src/services/session';
import {WellnessProvider} from '../../src/wellness/context/WellnessContext';
import ReportsScreen from '../../src/wellness/screens/ReportsScreen';
import RewardsScreen from '../../src/wellness/screens/RewardsScreen';
import WellnessHomeScreen from '../../src/wellness/screens/WellnessHomeScreen';
import {mockServer} from '../../test-utils/mockServer';
import {REWARDS_EMPTY, SETTINGS} from '../../test-utils/wellnessSettings';

jest.mock('../../src/wellness/native/stepCounter', () => ({
  isStepCounterSupported: jest.fn(async () => false),
  hasStepPermission: jest.fn(async () => false),
  requestStepPermission: jest.fn(async () => false),
  startStepUpdates: jest.fn(async () => null),
}));

const METRICS = {frame: {x: 0, y: 0, width: 360, height: 800}, insets: {top: 0, left: 0, right: 0, bottom: 0}};
const WEEK = Array.from({length: 7}, (_, i) => ({day: `2026-11-${18 + i}`, waterMl: 0, glasses: 0, steps: 0}));

const TODAY = (rewards = REWARDS_EMPTY) => ({
  day: '2026-11-24',
  settings: SETTINGS,
  defaults: SETTINGS,
  rewards,
  steps: {count: 0, goal: 6000, percent: 0, distanceKm: 0, kcal: 0, perStep: {km: 0.00075, kcal: 0.04}},
  water: {ml: 0, glasses: 0, goalMl: 2000, goalGlasses: 8, percent: 0},
  mood: null,
  goals: {items: [], done: 1, total: 3, percent: 33, complete: false},
  streak: {current: 0, best: 0},
  week: WEEK,
});

const BADGES = [
  {id: 'first_checkin', name: 'First check-in', icon: 'check-circle', target: 1, progress: 1, earned: true, earnedOn: '2026-11-21'},
  {id: 'streak3', name: '3-day streak', icon: 'fire', target: 3, progress: 1, earned: false, earnedOn: null},
  {id: 'water7', name: 'Water warrior', icon: 'water', target: 7, progress: 1, earned: false, earnedOn: null},
];
const REWARDS = (patch = {}) => ({
  balance: 40,
  rupees: 4,
  pointsPerRupee: 10,
  redeem: {unit: 500, unitRupees: 50, points: 0, rupees: 0, canRedeem: false, pointsToGo: 460},
  earn: [
    {id: 'water', label: 'Reach your water goal', points: 10},
    {id: 'complete', label: 'Complete the day', points: 5},
  ],
  challenges: [
    {id: 'water5', title: 'Reach your water goal on 5 days', target: 5, bonus: 30, progress: 1, done: false, weekStart: '2026-11-23'},
    {id: 'checkins7', title: 'Complete all 7 check-ins this week', target: 7, bonus: 30, progress: 7, done: true, weekStart: '2026-11-23'},
  ],
  badges: BADGES,
  history: [
    {id: 3, points: 25, label: 'Badge: First check-in', at: '2026-11-21T05:48:00.000Z'},
    {id: 2, points: 5, label: 'Daily check-in complete', at: '2026-11-21T05:48:00.000Z'},
    {id: 1, points: 10, label: 'Water goal reached', at: '2026-11-21T05:47:00.000Z'},
  ],
  wallet: [],
  ...patch,
});

const PERIOD = (over = {}) => ({
  label: '9 Nov – 15 Nov',
  from: '2026-11-09',
  to: '2026-11-15',
  days: 7,
  waterPercent: 21,
  glassesPerDay: 1.7,
  stepsPerDay: 857,
  totalSteps: 6000,
  distanceKm: 4.5,
  kcal: 240,
  completeDays: 1,
  moods: {great: 0, good: 2, okay: 0, low: 0},
  medicinePercent: null,
  ...over,
});
const REPORT = range => ({
  range,
  day: '2026-11-24',
  goals: {waterGlasses: 8, steps: 6000},
  summary: PERIOD({label: 'This one', from: '2026-11-23', days: 2, waterPercent: 17, glassesPerDay: 1.7, completeDays: 1}),
  periods: [PERIOD({label: 'This one', from: '2026-11-23', days: 2, waterPercent: 17, glassesPerDay: 1.7, completeDays: 1}), PERIOD()],
});

let tree;
const navigate = jest.fn();
const navigation = {navigate, getParent: () => ({goBack: jest.fn()})};

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
const pressText = async text => {
  const found = tree.root.findAll(
    n => typeof n.props.onPress === 'function' && n.findAll(c => c.type === 'Text' && [].concat(c.props.children).join('') === text).length > 0,
  );
  await ReactTestRenderer.act(async () => {
    await found[found.length - 1].props.onPress();
  });
};
const texts = () =>
  tree.root.findAll(n => typeof n.type === 'string' && n.type === 'Text').map(n => [].concat(n.props.children).join(''));
const hasText = pattern => texts().some(t => pattern.test(t));

beforeEach(async () => {
  jest.clearAllMocks();
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

describe('Home: achievements and reward points', () => {
  test('the first four badges and the points are on the dashboard, and both lead to Rewards', async () => {
    mockServer({'GET /wellness/today': () => [200, TODAY()]});
    await mount(WellnessHomeScreen);
    expect(hasText(/^Your achievements$/)).toBe(true);
    expect(hasText(/^First check-in$/)).toBe(true);
    expect(hasText(/^Fortnight focus$/)).toBe(true);
    expect(hasText(/^0\/14$|^0\/1$/)).toBe(true);
    expect(hasText(/^0 Points$/)).toBe(true);
    expect(hasText(/Get up to Rs 0 in your wallet/)).toBe(true);
    await press('See all achievements');
    await press('Redeem rewards');
    expect(navigate).toHaveBeenNthCalledWith(1, 'Rewards');
    expect(navigate).toHaveBeenNthCalledWith(2, 'Rewards');
  });

  test('a won badge shows the day it was won, and the points are worth money', async () => {
    const rewards = {balance: 620, rupees: 62, badgesEarned: 1, badgesTotal: 11, badges: BADGES.slice(0, 1)};
    mockServer({'GET /wellness/today': () => [200, TODAY(rewards)]});
    await mount(WellnessHomeScreen);
    expect(hasText(/^21 Nov$/)).toBe(true);
    expect(hasText(/^620 Points$/)).toBe(true);
    expect(hasText(/Get up to Rs 62/)).toBe(true);
  });
});

describe('Rewards', () => {
  test('shows the points, what they are worth, how to earn them, the challenges and the badges', async () => {
    mockServer({'GET /wellness/today': () => [200, TODAY()], 'GET /wellness/rewards': () => [200, REWARDS()]});
    await mount(RewardsScreen);
    expect(hasText(/^40$/)).toBe(true);
    expect(hasText(/Worth Rs 4 · 10 points = Rs 1/)).toBe(true);
    expect(hasText(/460 more to go/)).toBe(true);
    expect(hasText(/^Add Rs 50 to my wallet$/)).toBe(true);
    expect(hasText(/^Reach your water goal$/)).toBe(true);
    expect(hasText(/^\+10$/)).toBe(true);
    expect(hasText(/^1 of 5 · \+30 points$/)).toBe(true);
    expect(hasText(/^Done · \+30 points$/)).toBe(true);
    expect(hasText(/Badges \(1 of 3\)/)).toBe(true);
    expect(hasText(/^3-day streak$/)).toBe(true);
    expect(hasText(/^Badge: First check-in$/)).toBe(true);
    expect(hasText(/^\+25$/)).toBe(true);
  });

  test('with fewer than 500 points the wallet button is off', async () => {
    const calls = mockServer({'GET /wellness/today': () => [200, TODAY()], 'GET /wellness/rewards': () => [200, REWARDS()]});
    await mount(RewardsScreen);
    expect(control('Add to my wallet').props.disabled).toBe(true);
    expect(calls.some(c => c.key === 'POST /wellness/rewards/redeem')).toBe(false);
  });

  test('with enough points the button adds the money and the points drop', async () => {
    const rich = REWARDS({balance: 620, rupees: 62, redeem: {unit: 500, unitRupees: 50, points: 500, rupees: 50, canRedeem: true, pointsToGo: 0}});
    const after = {...REWARDS({balance: 120, rupees: 12}), added: 50, walletCredits: 50};
    const calls = mockServer({
      'GET /wellness/today': () => [200, TODAY()],
      'GET /wellness/rewards': () => [200, rich],
      'POST /wellness/rewards/redeem': () => [200, after],
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await mount(RewardsScreen);
    expect(hasText(/You can add Rs 50 to your wallet now/)).toBe(true);
    expect(hasText(/^Add Rs 50 to my wallet$/)).toBe(true);
    await press('Add to my wallet');
    expect(calls.find(c => c.key === 'POST /wellness/rewards/redeem').body).toEqual({points: 500});
    expect(alert).toHaveBeenCalledWith('Added to your wallet', expect.stringMatching(/Rs 50 added/));
    expect(hasText(/^120$/)).toBe(true);
    alert.mockRestore();
  });

  test('when the server refuses, the person is told and nothing is shown as added', async () => {
    const rich = REWARDS({balance: 620, redeem: {unit: 500, unitRupees: 50, points: 500, rupees: 50, canRedeem: true, pointsToGo: 0}});
    mockServer({
      'GET /wellness/today': () => [200, TODAY()],
      'GET /wellness/rewards': () => [200, rich],
      'POST /wellness/rewards/redeem': () => [409, {statusCode: 409, message: 'You do not have enough points.'}],
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await mount(RewardsScreen);
    await press('Add to my wallet');
    expect(alert).toHaveBeenCalledWith('Could not add to the wallet', 'You do not have enough points.');
    alert.mockRestore();
  });

  test('the wallet tab lists what was added', async () => {
    const withWallet = REWARDS({wallet: [{id: 9, points: 500, rupees: 50, at: '2026-11-22T10:00:00.000Z'}]});
    mockServer({'GET /wellness/today': () => [200, TODAY()], 'GET /wellness/rewards': () => [200, withWallet]});
    await mount(RewardsScreen);
    await pressText('Added to wallet');
    expect(hasText(/^Rs 50 added$/)).toBe(true);
    expect(hasText(/^-500 points$/)).toBe(true);
  });

  test('a server that cannot be reached says so and offers Retry', async () => {
    mockServer({'GET /wellness/today': () => [200, TODAY()], 'GET /wellness/rewards': () => [503, {statusCode: 503, message: 'Down'}]});
    await mount(RewardsScreen);
    expect(hasText(/Could not load your rewards/)).toBe(true);
  });
});

describe('Reports', () => {
  test('weekly is the first view: the tiles, this week, and the weeks before', async () => {
    const calls = mockServer({
      'GET /wellness/today': () => [200, TODAY()],
      'GET /wellness/reports': (body, headers, {query}) => [200, REPORT(query.range)],
    });
    await mount(ReportsScreen);
    expect(calls.find(c => c.key.startsWith('GET /wellness/reports')).key).toBe('GET /wellness/reports?range=weekly');
    expect(hasText(/^17%$/)).toBe(true);
    expect(hasText(/^1\.7 glasses a day$/)).toBe(true);
    expect(hasText(/^1\/2$/)).toBe(true); // complete days
    expect(hasText(/^This week$/)).toBe(true);
    expect(hasText(/^9 Nov – 15 Nov$/)).toBe(true);
    expect(hasText(/1 of 7 days complete/)).toBe(true);
  });

  test('Daily and Monthly load their own report', async () => {
    const calls = mockServer({
      'GET /wellness/today': () => [200, TODAY()],
      'GET /wellness/reports': (body, headers, {query}) => [200, REPORT(query.range)],
    });
    await mount(ReportsScreen);
    await pressText('Monthly');
    expect(calls.some(c => c.key === 'GET /wellness/reports?range=monthly')).toBe(true);
    expect(hasText(/^This month$/)).toBe(true);
    await pressText('Daily');
    expect(calls.some(c => c.key === 'GET /wellness/reports?range=daily')).toBe(true);
    expect(hasText(/^Today$/)).toBe(true);
  });

  test('a server that cannot be reached says so', async () => {
    mockServer({'GET /wellness/today': () => [200, TODAY()], 'GET /wellness/reports': () => [503, {statusCode: 503, message: 'Down'}]});
    await mount(ReportsScreen);
    expect(hasText(/Could not load your report/)).toBe(true);
  });
});
