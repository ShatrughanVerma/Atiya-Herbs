import React from 'react';
import {Alert} from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {AuthProvider} from '../../src/context/AuthContext';
import {endSession, startSession} from '../../src/services/session';
import {WellnessProvider} from '../../src/wellness/context/WellnessContext';
import {
  canRingOnTime,
  notificationsAllowed,
  openAlarmSettings,
  openNotificationSettings,
  pickMinutes,
  requestNotifications,
  setReminders,
  showTestReminder,
} from '../../src/wellness/native/reminders';
import WellnessHomeScreen from '../../src/wellness/screens/WellnessHomeScreen';
import WellnessProfileScreen from '../../src/wellness/screens/WellnessProfileScreen';
import {CHECKIN_ID, WATER_ID, clock12, planReminders, reminderKey} from '../../src/wellness/utils/reminderPlan';
import {mockServer} from '../../test-utils/mockServer';
import {REWARDS_EMPTY, SETTINGS} from '../../test-utils/wellnessSettings';

jest.mock('../../src/wellness/native/reminders', () => ({
  remindersSupported: true,
  notificationsAllowed: jest.fn(),
  requestNotifications: jest.fn(),
  canRingOnTime: jest.fn(),
  setReminders: jest.fn(),
  showTestReminder: jest.fn(),
  openAlarmSettings: jest.fn(),
  openNotificationSettings: jest.fn(),
  pickMinutes: jest.fn(),
}));

jest.mock('../../src/wellness/native/stepCounter', () => ({
  isStepCounterSupported: jest.fn(async () => false),
  hasStepPermission: jest.fn(async () => false),
  requestStepPermission: jest.fn(async () => false),
  startStepUpdates: jest.fn(async () => null),
}));

describe('what the phone should ring', () => {
  test('water rings every N minutes from the start up to and including the end', () => {
    const list = planReminders({...SETTINGS, checkinOn: false});
    expect(list.map(r => [r.hour, r.minute])).toEqual([[9, 0], [11, 0], [13, 0], [15, 0], [17, 0], [19, 0], [21, 0]]);
    expect(list[0].id).toBe(WATER_ID);
    expect(list[6].id).toBe(WATER_ID + 6);
    expect(planReminders({...SETTINGS, checkinOn: false, waterEveryMin: 90, waterFromMin: 540, waterUntilMin: 700}).map(r => [r.hour, r.minute])).toEqual([[9, 0], [10, 30]]);
  });

  test('the evening check-in is one reminder at its own time; switched off reminders are not planned', () => {
    const list = planReminders({...SETTINGS, waterReminderOn: false});
    expect(list).toEqual([expect.objectContaining({id: CHECKIN_ID, hour: 20, minute: 0, title: 'Evening check-in'})]);
    expect(planReminders({...SETTINGS, waterReminderOn: false, checkinOn: false})).toEqual([]);
  });

  test('every 30 minutes all day is still a sensible number of alarms', () => {
    const list = planReminders({...SETTINGS, checkinOn: false, waterEveryMin: 30, waterFromMin: 0, waterUntilMin: 1439});
    expect(list.length).toBe(48);
    expect(new Set(list.map(r => r.id)).size).toBe(48);
  });

  test('12-hour clock text, and the key changes only when a reminder field changes', () => {
    expect(clock12(540)).toBe('9:00 AM');
    expect(clock12(1260)).toBe('9:00 PM');
    expect(clock12(0)).toBe('12:00 AM');
    expect(clock12(750)).toBe('12:30 PM');
    expect(reminderKey({...SETTINGS, stepGoal: 9000, glassMl: 500})).toBe(reminderKey(SETTINGS));
    expect(reminderKey({...SETTINGS, waterEveryMin: 60})).not.toBe(reminderKey(SETTINGS));
  });
});

describe('Profile: goals and reminders', () => {
  const METRICS = {frame: {x: 0, y: 0, width: 360, height: 800}, insets: {top: 0, left: 0, right: 0, bottom: 0}};
  const WEEK = Array.from({length: 7}, (_, i) => ({day: `2026-11-${18 + i}`, waterMl: 0, glasses: 0, steps: 0}));
  const TODAY = (settings = SETTINGS) => ({
    day: '2026-11-24',
    settings,
    defaults: SETTINGS,
    rewards: REWARDS_EMPTY,
    steps: {count: 0, goal: settings.stepGoal, percent: 0, distanceKm: 0, kcal: 0, perStep: {km: 0.00075, kcal: 0.04}},
    water: {ml: 0, glasses: 0, goalMl: 2000, goalGlasses: 8, percent: 0},
    mood: null,
    goals: {items: [], done: 1, total: 3, percent: 33, complete: false},
    streak: {current: 0, best: 0},
    week: WEEK,
  });

  let tree;
  const navigate = jest.fn();
  const navigation = {navigate, getParent: () => ({navigate, goBack: jest.fn()})};

  const mount = async (Screen = WellnessProfileScreen) => {
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
  const control = (label, prop = 'onPress') => {
    const found = tree.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props[prop] === 'function');
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
  const flush = async () => {
    await ReactTestRenderer.act(async () => {});
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    Keychain.__store.clear();
    await endSession();
    await startSession({accessToken: 'a1', refreshToken: 'r1', user: {id: 'u1'}});
    notificationsAllowed.mockResolvedValue(true);
    canRingOnTime.mockResolvedValue(true);
    requestNotifications.mockResolvedValue(true);
    setReminders.mockResolvedValue(8);
    showTestReminder.mockResolvedValue(undefined);
    pickMinutes.mockResolvedValue(null);
  });

  afterEach(async () => {
    await ReactTestRenderer.act(async () => {
      tree?.unmount();
    });
    tree = null;
  });

  test('Home has a bell: it opens the Profile tab, and a red dot says when notifications are off', async () => {
    mockServer({'GET /wellness/today': () => [200, TODAY()]});
    await mount(WellnessHomeScreen);
    await flush();
    expect(tree.root.findAll(n => n.props.accessibilityLabel === 'Notifications are off')).toHaveLength(0);
    await press('Notifications');
    expect(navigate).toHaveBeenCalledWith('Profile');

    await ReactTestRenderer.act(async () => {
      tree.unmount();
    });
    notificationsAllowed.mockResolvedValue(false);
    await mount(WellnessHomeScreen);
    await flush();
    expect(tree.root.findAll(n => n.props.accessibilityLabel === 'Notifications are off').length).toBeGreaterThan(0);
  });

  test('shows the goals and every reminder with its usual value marked "(default)"', async () => {
    mockServer({'GET /wellness/today': () => [200, TODAY()]});
    await mount();
    expect(hasText(/^My goals$/)).toBe(true);
    expect(hasText(/^Water reminders$/)).toBe(true);
    expect(hasText(/^Medicine times$/)).toBe(true);
    expect(hasText(/^Evening check-in$/)).toBe(true);
    expect(hasText(/^Notifications$/)).toBe(true);
    expect(hasText(/^9:00 AM$/)).toBe(true); // water from
    expect(hasText(/^8:00 AM$/)).toBe(true); // morning medicine
    expect(hasText(/^8:00 PM$/)).toBe(true); // evening check-in
    expect(texts().filter(x => /\(default\)/.test(x)).length).toBeGreaterThan(5);
  });

  test('a changed value loses its "(default)" mark', async () => {
    mockServer({'GET /wellness/today': () => [200, TODAY({...SETTINGS, waterEveryMin: 60})]});
    await mount();
    const every = tree.root.findAll(n => typeof n.type === 'string' && n.type === 'Text' && [].concat(n.props.children).join('') === 'Every');
    expect(every.length).toBeGreaterThan(0);
    // the "Every" label no longer has the mark next to it
    const label = every[0].parent;
    expect(label.findAll(c => c.type === 'Text' && /\(default\)/.test([].concat(c.props.children).join(''))).length).toBe(0);
  });

  test('a chip changes how often water is asked for', async () => {
    const calls = mockServer({
      'GET /wellness/today': () => [200, TODAY()],
      'PUT /wellness/settings': body => [200, TODAY({...SETTINGS, ...body})],
    });
    await mount();
    await pressText('1 h');
    expect(calls.find(c => c.key === 'PUT /wellness/settings').body).toEqual({waterEveryMin: 60});
  });

  test('the switch turns the water reminders off and hides their details', async () => {
    const calls = mockServer({
      'GET /wellness/today': () => [200, TODAY()],
      'PUT /wellness/settings': body => [200, TODAY({...SETTINGS, ...body})],
    });
    await mount();
    expect(hasText(/^From$/)).toBe(true);
    await ReactTestRenderer.act(async () => {
      control('Water reminders', 'onValueChange').props.onValueChange(false);
    });
    expect(calls.find(c => c.key === 'PUT /wellness/settings').body).toEqual({waterReminderOn: false});
    expect(hasText(/^From$/)).toBe(false);
  });

  test('a time is chosen with the phone time picker and saved as minutes after midnight', async () => {
    const calls = mockServer({
      'GET /wellness/today': () => [200, TODAY()],
      'PUT /wellness/settings': body => [200, TODAY({...SETTINGS, ...body})],
    });
    pickMinutes.mockResolvedValue(8 * 60 + 30);
    await mount();
    await press('Morning time');
    expect(pickMinutes).toHaveBeenCalledWith(480);
    expect(calls.find(c => c.key === 'PUT /wellness/settings').body).toEqual({medMorningMin: 510});
    expect(hasText(/^8:30 AM$/)).toBe(true);
  });

  test('a cancelled time picker changes nothing', async () => {
    const calls = mockServer({'GET /wellness/today': () => [200, TODAY()]});
    await mount();
    await press('Night time');
    expect(calls.some(c => c.key === 'PUT /wellness/settings')).toBe(false);
  });

  test('water reminders that would end before they start are stopped on the phone', async () => {
    const calls = mockServer({'GET /wellness/today': () => [200, TODAY()]});
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    pickMinutes.mockResolvedValue(22 * 60); // "From" 10:00 PM, but "Until" is 9:00 PM
    await mount();
    await press('From time');
    expect(alert).toHaveBeenCalledWith('From', expect.stringMatching(/end after they start/));
    expect(calls.some(c => c.key === 'PUT /wellness/settings')).toBe(false);
    alert.mockRestore();
  });

  test('the alarms are set from the settings, and again when they change', async () => {
    mockServer({
      'GET /wellness/today': () => [200, TODAY()],
      'PUT /wellness/settings': body => [200, TODAY({...SETTINGS, ...body})],
    });
    await mount();
    await flush();
    expect(setReminders).toHaveBeenCalledTimes(1);
    expect(setReminders.mock.calls[0][0]).toHaveLength(8); // 7 water reminders + the check-in
    await pressText('3 h');
    await flush();
    expect(setReminders).toHaveBeenCalledTimes(2);
    expect(setReminders.mock.calls[1][0].filter(r => r.id >= WATER_ID && r.id < 2000)).toHaveLength(5); // 9, 12, 15, 18, 21
  });

  test('a goal change does not set the alarms again', async () => {
    mockServer({
      'GET /wellness/today': () => [200, TODAY()],
      'PUT /wellness/settings': body => [200, TODAY({...SETTINGS, ...body})],
    });
    await mount();
    await flush();
    await press('One glass more');
    await flush();
    expect(setReminders).toHaveBeenCalledTimes(1);
  });

  test('without the notification permission no alarm is set and the person is asked to allow them', async () => {
    notificationsAllowed.mockResolvedValue(false);
    mockServer({'GET /wellness/today': () => [200, TODAY()]});
    await mount();
    await flush();
    expect(setReminders).not.toHaveBeenCalled();
    expect(hasText(/Notifications are off/)).toBe(true);

    notificationsAllowed.mockResolvedValue(true);
    await press('Allow notifications');
    await flush();
    expect(requestNotifications).toHaveBeenCalled();
    expect(hasText(/Notifications are off/)).toBe(false);
    expect(setReminders).toHaveBeenCalledTimes(1); // now the alarms are set
  });

  test('a permission that stays refused sends the person to the phone settings', async () => {
    notificationsAllowed.mockResolvedValue(false);
    requestNotifications.mockResolvedValue(false);
    mockServer({'GET /wellness/today': () => [200, TODAY()]});
    await mount();
    await press('Allow notifications');
    expect(openNotificationSettings).toHaveBeenCalled();
  });

  test('when Android may delay the alarms a note offers the "Alarms & reminders" setting', async () => {
    canRingOnTime.mockResolvedValue(false);
    mockServer({'GET /wellness/today': () => [200, TODAY()]});
    await mount();
    await flush();
    expect(hasText(/may come a few minutes late/)).toBe(true);
    await press('Allow alarms and reminders');
    expect(openAlarmSettings).toHaveBeenCalled();
  });

  test('the test reminder, the phone settings and Edit my profile', async () => {
    mockServer({'GET /wellness/today': () => [200, TODAY()]});
    await mount();
    await press('Send a test reminder');
    expect(showTestReminder).toHaveBeenCalledWith('Health Wellness', expect.any(String));
    await press('Notification settings');
    expect(openNotificationSettings).toHaveBeenCalled();
    await press('Edit my profile');
    expect(navigate).toHaveBeenCalledWith('EditProfile');
  });

  test('"Use the clinic\'s settings" asks first, then sends the usual values', async () => {
    const calls = mockServer({
      'GET /wellness/today': () => [200, TODAY({...SETTINGS, waterGoalGlasses: 12, waterEveryMin: 30})],
      'PUT /wellness/settings': body => [200, TODAY({...SETTINGS, ...body})],
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await mount();
    await press("Use the clinic's settings");
    expect(alert).toHaveBeenCalled();
    expect(calls.some(c => c.key === 'PUT /wellness/settings')).toBe(false); // nothing yet
    const buttons = alert.mock.calls[0][2];
    await ReactTestRenderer.act(async () => {
      buttons.find(b => b.text === 'Use them').onPress();
    });
    expect(calls.find(c => c.key === 'PUT /wellness/settings').body).toEqual(SETTINGS);
    alert.mockRestore();
  });
});
