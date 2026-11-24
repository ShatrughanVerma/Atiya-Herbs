import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {AuthProvider} from '../../src/context/AuthContext';
import {endSession, startSession} from '../../src/services/session';
import {
  hasStepPermission,
  isStepCounterSupported,
  requestStepPermission,
  startStepUpdates,
} from '../../src/wellness/native/stepCounter';
import {WellnessProvider} from '../../src/wellness/context/WellnessContext';
import WellnessHomeScreen from '../../src/wellness/screens/WellnessHomeScreen';
import {applyReading, clock, distanceKm, kcalOf, pace, todayIst} from '../../src/wellness/utils/stepMath';
import {mockServer} from '../../test-utils/mockServer';
import {REWARDS_EMPTY, SETTINGS} from '../../test-utils/wellnessSettings';

jest.mock('../../src/wellness/native/stepCounter', () => ({
  isStepCounterSupported: jest.fn(),
  hasStepPermission: jest.fn(),
  requestStepPermission: jest.fn(),
  startStepUpdates: jest.fn(),
}));

const METRICS = {
  frame: {x: 0, y: 0, width: 360, height: 800},
  insets: {top: 0, left: 0, right: 0, bottom: 0},
};

const TODAY = (steps = 0) => ({
  day: todayIst(),
  settings: SETTINGS,
  defaults: SETTINGS,
  rewards: REWARDS_EMPTY,
  steps: {count: steps, goal: 6000, percent: 0, distanceKm: 0, kcal: 0, perStep: {km: 0.00075, kcal: 0.04}},
  water: {ml: 0, glasses: 0, goalMl: 2000, goalGlasses: 8, percent: 0},
  mood: null,
  goals: {items: [{id: 'water', done: false}, {id: 'medicines', done: true, none: true}, {id: 'mood', done: false}], done: 1, total: 3, percent: 33, complete: false},
  streak: {current: 0, best: 0},
  week: Array.from({length: 7}, (_, i) => ({day: `2026-11-${18 + i}`, waterMl: 0, glasses: 0, steps: 0})),
});

// The server side of a step sync: it counts every batch id once and answers with today's view
const batchesRoute = () => {
  const seen = new Set();
  let total = 0;
  return body => {
    body.batches.forEach(b => {
      if (!seen.has(b.batchId)) {
        seen.add(b.batchId);
        total += b.steps;
      }
    });
    return [200, {...TODAY(total), batches: {received: body.batches.length}}];
  };
};
const sentBatches = calls => calls.filter(c => c.key === 'POST /wellness/steps/batches').flatMap(c => c.body.batches);

describe('step maths', () => {
  const D1 = '2026-11-24';

  test('the first reading of a day starts at zero, later readings add what the sensor counted', () => {
    let state = applyReading(null, 5000, D1);
    expect(state).toEqual({day: D1, steps: 0, lastCounter: 5000});
    state = applyReading(state, 5120, D1);
    state = applyReading(state, 5121, D1);
    expect(state.steps).toBe(121);
  });

  test('a new day starts again from zero', () => {
    const state = applyReading({day: '2026-11-23', steps: 8000, lastCounter: 9000}, 9500, D1);
    expect(state).toEqual({day: D1, steps: 0, lastCounter: 9500});
  });

  test('a lower reading means the phone restarted: the sensor began again from zero', () => {
    const state = applyReading({day: D1, steps: 300, lastCounter: 20000}, 40, D1);
    expect(state).toEqual({day: D1, steps: 340, lastCounter: 40});
  });

  test('the Indian day, distance, calories, clock and pace', () => {
    expect(todayIst(Date.parse('2026-11-24T18:29:00Z'))).toBe('2026-11-24');
    expect(todayIst(Date.parse('2026-11-24T18:30:00Z'))).toBe('2026-11-25');
    expect(distanceKm(4000)).toBe(3);
    expect(kcalOf(4000)).toBe(160);
    expect(clock(1245)).toBe('20:45');
    expect(clock(3700)).toBe('1:01:40');
    expect(pace(1200, 2)).toBe('10:00');
    expect(pace(60, 0)).toBe('--');
  });
});

describe('step batches (on the phone)', () => {
  const {BATCH_EVERY_STEPS, BATCH_EVERY_MS, MAX_AGE_MS, addSteps, closeOpen, confirmed, emptyState, endOfDayIso, isDue, newBatchId, nextToSend} = require('../../src/wellness/utils/stepBatches');

  test('a batch is closed after 20 steps or after a minute, whichever comes first', () => {
    let state = addSteps(emptyState(), 10, 1000);
    expect(isDue(state, 2000)).toBe(false);
    expect(isDue(state, 1000 + BATCH_EVERY_MS)).toBe(true); // a minute has passed
    state = addSteps(state, BATCH_EVERY_STEPS, 3000);
    expect(isDue(state, 3000)).toBe(true); // 30 steps
    expect(state.open).toEqual({steps: 30, since: 1000}); // the batch began with its first steps
    expect(isDue(emptyState(), 1e12)).toBe(false); // nothing to close
  });

  test('closing moves the open batch into the queue with its id and time', () => {
    const state = closeOpen(addSteps(emptyState(), 25, 0), '2026-11-24T05:00:00.000Z', 'batch-0000001');
    expect(state).toEqual({open: null, queue: [{batchId: 'batch-0000001', steps: 25, recordedAt: '2026-11-24T05:00:00.000Z'}]});
    expect(closeOpen(emptyState(), 'x')).toEqual({open: null, queue: []});
  });

  test('the ids are different every time and look the way the server wants', () => {
    const ids = new Set(Array.from({length: 200}, () => newBatchId()));
    expect(ids.size).toBe(200);
    [...ids].forEach(id => expect(id).toMatch(/^[A-Za-z0-9_-]{8,40}$/));
  });

  test('at most 100 go in one request, the oldest first, and none that are too old for the server', () => {
    const now = Date.parse('2026-11-24T10:00:00Z');
    const queue = Array.from({length: 120}, (_, i) => ({batchId: `b-${String(i).padStart(7, '0')}`, steps: 5, recordedAt: new Date(now - 1000 * (120 - i)).toISOString()}));
    queue.unshift({batchId: 'b-too-old-1', steps: 5, recordedAt: new Date(now - MAX_AGE_MS - 1000).toISOString()});
    const list = nextToSend({open: null, queue}, now);
    expect(list).toHaveLength(100);
    expect(list[0].batchId).toBe('b-0000000');
    const left = confirmed({open: null, queue}, list.map(b => b.batchId), now);
    expect(left.queue.map(b => b.batchId)).toEqual(queue.slice(101).map(b => b.batchId)); // the too-old one is dropped as well
  });

  test('the steps of a day that has ended are put at 11:59 PM of that day, Indian time', () => {
    expect(endOfDayIso('2026-11-24')).toBe('2026-11-24T18:29:00.000Z');
  });
});

describe('live steps and Walk mode', () => {
  let tree;
  let emit;
  let stopUpdates;
  const navigation = {navigate: jest.fn(), getParent: () => ({goBack: jest.fn()})};

  const mount = async () => {
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <SafeAreaProvider initialMetrics={METRICS}>
          <AuthProvider>
            <WellnessProvider>
              <WellnessHomeScreen navigation={navigation} />
            </WellnessProvider>
          </AuthProvider>
        </SafeAreaProvider>,
      );
    });
  };
  const reading = async total => {
    await ReactTestRenderer.act(async () => {
      emit(total);
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
    tree.root.findAll(n => typeof n.type === 'string' && n.type === 'Text').map(n => [].concat(n.props.children).join(''));
  const hasText = pattern => texts().some(x => pattern.test(x));

  beforeEach(async () => {
    jest.clearAllMocks(); // the call counts of the step counter mocks start again in every test
    await AsyncStorage.clear();
    Keychain.__store.clear();
    await endSession();
    await startSession({accessToken: 'a1', refreshToken: 'r1', user: {id: 'u1'}});
    stopUpdates = jest.fn();
    isStepCounterSupported.mockResolvedValue(true);
    hasStepPermission.mockResolvedValue(true);
    requestStepPermission.mockResolvedValue(true);
    startStepUpdates.mockImplementation(async onSteps => {
      emit = onSteps;
      return stopUpdates;
    });
  });

  afterEach(async () => {
    await ReactTestRenderer.act(async () => {
      tree?.unmount();
    });
    tree = null;
    jest.restoreAllMocks();
  });

  test('steps show live, with distance and calories, and go to the server every few steps', async () => {
    const calls = mockServer({
      'GET /wellness/today': () => [200, TODAY()],
      'POST /wellness/steps/batches': batchesRoute(),
    });
    await mount();
    await reading(10000); // the first reading of the day is the starting point
    expect(hasText(/^0$/)).toBe(true);

    await reading(10010);
    expect(hasText(/^10$/)).toBe(true);
    expect(sentBatches(calls)).toHaveLength(0); // 10 steps: too few for a batch yet

    await reading(10100);
    expect(hasText(/^100$/)).toBe(true);
    expect(hasText(/^0.08 km$/)).toBe(true);
    expect(hasText(/^4$/)).toBe(true); // calories
    expect(sentBatches(calls)).toEqual([expect.objectContaining({steps: 100, batchId: expect.stringMatching(/^[A-Za-z0-9_-]{8,40}$/), recordedAt: expect.any(String)})]);
  });

  test('leaving the screen stops the sensor and sends the last steps', async () => {
    const calls = mockServer({
      'GET /wellness/today': () => [200, TODAY()],
      'POST /wellness/steps/batches': batchesRoute(),
    });
    await mount();
    await reading(500);
    await reading(512); // 12 steps: not enough for an update yet
    await ReactTestRenderer.act(async () => {
      tree.unmount();
    });
    tree = null;
    expect(stopUpdates).toHaveBeenCalled();
    expect(sentBatches(calls)).toEqual([expect.objectContaining({steps: 12})]);
  });

  test('without internet the batch waits in the queue; after a restart it is sent again with the same id and counted once', async () => {
    let up = false;
    const route = batchesRoute();
    const calls = mockServer({
      'GET /wellness/today': () => [200, TODAY()],
      'POST /wellness/steps/batches': body => (up ? route(body) : [503, {statusCode: 503, message: 'Down'}]),
    });
    await mount();
    await reading(1000);
    await reading(1060); // 60 steps: a batch is closed and the send fails
    expect(sentBatches(calls)).toHaveLength(1);
    const first = sentBatches(calls)[0];
    expect(JSON.parse(await AsyncStorage.getItem('atiya.wellness.stepqueue.v1')).queue).toEqual([first]); // still waiting

    await ReactTestRenderer.act(async () => {
      tree.unmount();
    });
    tree = null;
    up = true; // the internet is back, the app is opened again
    await mount();
    // the same batch was sent again (also when the app was closed, while the internet was still down), and the server counted it once
    expect(sentBatches(calls).filter(b => b.batchId === first.batchId).length).toBeGreaterThanOrEqual(2);
    expect(new Set(sentBatches(calls).map(b => b.batchId)).size).toBe(1);
    expect(JSON.parse(await AsyncStorage.getItem('atiya.wellness.stepqueue.v1')).queue).toEqual([]); // confirmed
    expect(hasText(/^60$/)).toBe(true);
  });

  test('a half-filled batch is not lost when the app is closed', async () => {
    const calls = mockServer({'GET /wellness/today': () => [200, TODAY()], 'POST /wellness/steps/batches': batchesRoute()});
    await mount();
    await reading(2000);
    await reading(2007); // 7 steps in the open batch
    await ReactTestRenderer.act(async () => {
      tree.unmount();
    });
    tree = null;
    expect(sentBatches(calls)).toEqual([expect.objectContaining({steps: 7})]);
  });

  test('a batch the server refuses is dropped, so it does not block the ones behind it', async () => {
    let n = 0;
    const calls = mockServer({
      'GET /wellness/today': () => [200, TODAY()],
      'POST /wellness/steps/batches': () => (n++ === 0 ? [400, {statusCode: 400, message: 'Some details are not valid.'}] : [200, TODAY(30)]),
    });
    await mount();
    await reading(10);
    await reading(60); // 50 steps: refused
    expect(JSON.parse(await AsyncStorage.getItem('atiya.wellness.stepqueue.v1')).queue).toEqual([]);
    await reading(90); // 30 more: accepted
    expect(sentBatches(calls)).toHaveLength(2);
  });

  test('the last 10 minutes from the server are shown when Redis is there, and hidden when it is not', async () => {
    mockServer({
      'GET /wellness/today': () => [200, TODAY()],
      'GET /wellness/steps/recent': () => [200, {available: true, windowSeconds: 600, steps: 85, batches: 3, perMinute: [0, 0, 10, 0, 20, 0, 0, 30, 5, 20]}],
    });
    await mount();
    expect(hasText(/^Last 10 minutes$/)).toBe(true);
    expect(hasText(/^85 steps$/)).toBe(true);

    await ReactTestRenderer.act(async () => {
      tree.unmount();
    });
    tree = null;
    mockServer({'GET /wellness/today': () => [200, TODAY()], 'GET /wellness/steps/recent': () => [200, {available: false}]});
    await mount();
    expect(hasText(/Last 10 minutes/)).toBe(false);
  });

  test('a phone without a step counter says so', async () => {
    isStepCounterSupported.mockResolvedValue(false);
    mockServer({'GET /wellness/today': () => [200, TODAY()]});
    await mount();
    expect(hasText(/no step counter/)).toBe(true);
    expect(startStepUpdates).not.toHaveBeenCalled();
  });

  test('without the permission a button asks for it, and then the counting starts', async () => {
    hasStepPermission.mockResolvedValue(false);
    mockServer({'GET /wellness/today': () => [200, TODAY()]});
    await mount();
    expect(startStepUpdates).not.toHaveBeenCalled();
    await press('Turn on step counting');
    expect(requestStepPermission).toHaveBeenCalled();
    expect(startStepUpdates).toHaveBeenCalled();
    await reading(100);
    await reading(160);
    expect(hasText(/^60$/)).toBe(true);
  });

  test('a refused permission says where to allow it', async () => {
    hasStepPermission.mockResolvedValue(false);
    requestStepPermission.mockResolvedValue(false);
    mockServer({'GET /wellness/today': () => [200, TODAY()]});
    await mount();
    await press('Turn on step counting');
    expect(hasText(/Physical activity/)).toBe(true);
    expect(startStepUpdates).not.toHaveBeenCalled();
  });

  test('the server may know more steps than this phone: the larger number is shown', async () => {
    mockServer({'GET /wellness/today': () => [200, TODAY(4321)]});
    await mount();
    expect(hasText(/^4,321$/)).toBe(true);
  });

  test('Walk mode: start, walk, stop saves the walk and shows the summary', async () => {
    const calls = mockServer({
      'GET /wellness/today': () => [200, TODAY()],
      'POST /wellness/steps/batches': batchesRoute(),
      'POST /wellness/walks': body => [
        201,
        {id: 1, startedAt: body.startedAt, durationSec: body.durationSec, steps: body.steps, distanceKm: 0.75, kcal: 40},
      ],
    });
    const alert = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
    const realNow = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(realNow);
    await mount();
    await reading(1000);
    await reading(1100);
    await press('Start walk');
    await reading(2100); // 1000 steps during the walk
    clock.mockReturnValue(realNow + 1200 * 1000); // 20 minutes later
    await press('Stop walk');

    const posted = calls.find(c => c.key === 'POST /wellness/walks').body;
    expect(posted).toMatchObject({durationSec: 1200, steps: 1000});
    expect(new Date(posted.startedAt).getTime()).toBe(realNow);
    expect(alert).toHaveBeenCalledWith('Walk saved', expect.stringMatching(/1,000 steps, 0\.75 km, 40 kcal in 20:00/));
    expect(control('Start walk')).toBeTruthy(); // ready for the next walk
  });

  test('a walk shorter than 10 seconds is not saved', async () => {
    const calls = mockServer({'GET /wellness/today': () => [200, TODAY()], 'POST /wellness/steps/batches': batchesRoute()});
    const alert = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
    await mount();
    await reading(100);
    await press('Start walk');
    await press('Stop walk');
    expect(calls.some(c => c.key === 'POST /wellness/walks')).toBe(false);
    expect(alert).toHaveBeenCalledWith('Walk too short', expect.any(String));
  });
});
