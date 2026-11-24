import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  canRingOnTime,
  notificationsAllowed,
  openNotificationSettings,
  remindersSupported,
  requestNotifications,
  setReminders,
  showTestReminder,
} from '../native/reminders';
import {
  hasStepPermission,
  isStepCounterSupported,
  requestStepPermission,
  startStepUpdates,
} from '../native/stepCounter';
import {
  addWalk,
  addWaterMl,
  addStepBatches,
  fetchRecentSteps,
  fetchToday,
  saveMood,
  saveSettings,
} from '../services/wellnessApi';
import { planReminders, reminderKey } from '../utils/reminderPlan';
import {
  addSteps,
  closeOpen,
  confirmed,
  emptyState,
  endOfDayIso,
  isDue,
  nextToSend,
} from '../utils/stepBatches';
import { applyReading, todayIst } from '../utils/stepMath';

const WellnessContext = createContext(null);

const MAX_WATER_ML = 10000; // the same ceiling as the backend
const STEPS_KEY = 'atiya.wellness.steps.v1';
const QUEUE_KEY = 'atiya.wellness.stepqueue.v1';
const TICK_MS = 15000; // how often a waiting batch is closed and the queue is sent
const RECENT_EVERY_MS = 30000; // how often the "last 10 minutes" is asked for
const MIN_WALK_SECONDS = 10;

// Recounts the day's goals after a change made on the phone, so the screen answers at once
const withGoals = today => {
  const items = today.goals.items.map(goal => {
    if (goal.id === 'water') {
      return { ...goal, done: today.water.ml >= today.water.goalMl };
    }
    if (goal.id === 'mood') {
      return { ...goal, done: !!today.mood };
    }
    return goal;
  });
  const done = items.filter(goal => goal.done).length;
  return {
    ...today,
    goals: {
      items,
      done,
      total: items.length,
      percent: Math.round((done / items.length) * 100),
      complete: done === items.length,
    },
  };
};

const withWater = (today, ml) => {
  const nextMl = Math.max(0, Math.min(MAX_WATER_ML, today.water.ml + ml));
  return withGoals({
    ...today,
    water: {
      ...today.water,
      ml: nextMl,
      glasses: Math.floor(nextMl / today.settings.glassMl),
      percent: Math.min(100, Math.round((nextMl / today.water.goalMl) * 100)),
    },
  });
};

// Today's wellness of the logged-in person, shared by the five tabs of the module.
//  - A tap on a glass or a mood shows at once; the answer of the server (which also knows the streak) replaces it.
//  - Taps are sent one after the other, so a quick double tap never arrives in the wrong order.
//  - Steps: while the module is open the phone's step counter reports live. The steps of today are kept on the phone
//    and sent to the server every few steps. `stepStatus` is 'checking' | 'unsupported' | 'off' | 'denied' | 'on'.
//  - Walk mode: Start remembers the step count; Stop sends the walk to the server.
export function WellnessProvider({ children }) {
  const [today, setToday] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState(null);
  const alive = useRef(true);
  const todayRef = useRef(null);
  const queue = useRef(Promise.resolve());
  const inFlight = useRef(0);
  todayRef.current = today;

  const load = useCallback(async () => {
    try {
      const data = await fetchToday();
      if (alive.current) {
        setToday(data);
        setStatus('ready');
        setError(null);
      }
    } catch (e) {
      if (alive.current) {
        setError(e);
        // data that is already on the screen stays; only an empty screen turns into an error
        setStatus(todayRef.current ? 'ready' : 'error');
      }
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  const run = useCallback(
    (optimistic, call) => {
      if (optimistic) {
        setToday(prev => (prev ? optimistic(prev) : prev));
      }
      inFlight.current += 1;
      const next = queue.current
        .then(call)
        .then(data => {
          inFlight.current -= 1;
          // only the answer to the LAST tap is shown, so the screen does not jump back and forth
          if (alive.current && inFlight.current === 0) {
            setToday(data);
            setError(null);
          }
        })
        .catch(async e => {
          inFlight.current -= 1;
          if (alive.current) {
            setError(e);
          }
          await load(); // show what the server really has
        });
      queue.current = next;
      return next;
    },
    [load],
  );

  const addWater = useCallback(
    ml => run(t => withWater(t, ml), () => addWaterMl(ml)),
    [run],
  );
  const setMood = useCallback(
    mood => run(t => withGoals({ ...t, mood }), () => saveMood(mood)),
    [run],
  );
  const updateSettings = useCallback(
    changes => run(null, () => saveSettings(changes)),
    [run],
  );

  // ---------------------------------------------------------------- reminders
  // status: 'checking' | 'unsupported' | 'allowed' | 'blocked'. onTime = the alarms ring exactly on time
  // (Android 12 and later need the "Alarms & reminders" permission for that).
  const [notifications, setNotifications] = useState({
    status: 'checking',
    onTime: true,
  });
  const refreshNotifications = useCallback(async () => {
    if (!remindersSupported) {
      setNotifications({ status: 'unsupported', onTime: true });
      return;
    }
    const [allowed, onTime] = await Promise.all([
      notificationsAllowed(),
      canRingOnTime(),
    ]);
    if (alive.current) {
      setNotifications({ status: allowed ? 'allowed' : 'blocked', onTime });
    }
  }, []);

  // looked at again when the person comes back from the phone's settings
  useEffect(() => {
    refreshNotifications();
    const appState = AppState.addEventListener('change', next => {
      if (next === 'active') {
        refreshNotifications();
      }
    });
    return () => appState.remove();
  }, [refreshNotifications]);

  const enableNotifications = useCallback(async () => {
    const allowed = await requestNotifications();
    if (!allowed) {
      openNotificationSettings(); // refused before: only the phone's settings can allow it now
    }
    await refreshNotifications();
  }, [refreshNotifications]);

  const sendTestReminder = useCallback(async () => {
    await showTestReminder(
      'Health Wellness',
      'This is how your reminders will look.',
    );
  }, []);

  // The alarms follow the settings. A new phone or a reinstall sets them again here.
  const reminderSettings = today?.settings;
  const plan = reminderSettings ? reminderKey(reminderSettings) : '';
  useEffect(() => {
    if (!reminderSettings || notifications.status !== 'allowed') {
      return;
    }
    setReminders(planReminders(reminderSettings)).catch(() => {});
    // only a change of the reminder fields sets the alarms again
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, notifications.status]);

  // ---------------------------------------------------------------- steps
  const [stepStatus, setStepStatus] = useState('checking');
  const [localSteps, setLocalSteps] = useState(0); // today's steps counted on this phone
  const [recentSteps, setRecentSteps] = useState({ available: false }); // the last 10 minutes (Redis, on the server)
  const tracker = useRef(null); // { day, steps, lastCounter }
  const batches = useRef(emptyState()); // { open, queue }: see utils/stepBatches.js
  const stopUpdates = useRef(null);
  const sending = useRef(false);
  const lastSaved = useRef(0);

  const persist = useCallback(force => {
    const now = Date.now();
    if (force || now - lastSaved.current > 1000) {
      lastSaved.current = now;
      AsyncStorage.setItem(STEPS_KEY, JSON.stringify(tracker.current)).catch(
        () => {},
      );
      AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(batches.current)).catch(
        () => {},
      );
    }
  }, []);

  const loadRecent = useCallback(async () => {
    try {
      const recent = await fetchRecentSteps();
      if (alive.current) {
        setRecentSteps(recent);
      }
    } catch {
      // not shown this time
    }
  }, []);

  // Sends the waiting batches. The server counts each batch id once, so a repeat after a bad connection is harmless;
  // what it did not confirm stays in the queue and goes with the next try (even after the app was closed).
  const flush = useCallback(async () => {
    if (sending.current) {
      return;
    }
    const list = nextToSend(batches.current);
    if (list.length === 0) {
      return;
    }
    sending.current = true;
    try {
      const data = await addStepBatches(list);
      batches.current = confirmed(batches.current, list.map(b => b.batchId));
      persist(true);
      if (alive.current) {
        // only the parts of the answer that steps change: a water tap in the meantime must not be undone
        setToday(prev =>
          prev
            ? { ...prev, steps: data.steps, week: data.week, rewards: data.rewards, streak: data.streak }
            : data,
        );
        loadRecent();
      }
    } catch (e) {
      if (e?.kind === 'validation') {
        // the server refused a batch: drop it, or the queue would be stuck behind it for ever
        batches.current = confirmed(batches.current, [list[0].batchId]);
        persist(true);
      }
      // otherwise (no internet, server down) the batches stay and go with the next try
    } finally {
      sending.current = false;
    }
  }, [persist, loadRecent]);

  // The open batch is closed when it has enough steps or has waited long enough; then the queue is sent
  const closeIfDue = useCallback(
    (force, recordedAt) => {
      if (force || isDue(batches.current)) {
        batches.current = closeOpen(batches.current, recordedAt ?? new Date().toISOString());
        persist(true);
        flush();
      }
    },
    [persist, flush],
  );

  const onReading = useCallback(
    counter => {
      const day = todayIst();
      const before = tracker.current;
      if (before && before.day !== day) {
        // a new day: the steps of the old one are closed first, with the end of that day as their time
        closeIfDue(true, endOfDayIso(before.day));
      }
      tracker.current = applyReading(before, counter, day);
      const gained = before && before.day === day ? tracker.current.steps - before.steps : 0;
      batches.current = addSteps(batches.current, gained);
      setLocalSteps(tracker.current.steps);
      persist(false);
      closeIfDue(false);
    },
    [persist, closeIfDue],
  );

  const begin = useCallback(async () => {
    if (stopUpdates.current) {
      return true;
    }
    const stop = await startStepUpdates(onReading);
    if (!stop) {
      return false;
    }
    if (!alive.current) {
      stop();
      return true;
    }
    stopUpdates.current = stop;
    return true;
  }, [onReading]);

  useEffect(() => {
    (async () => {
      try {
        const [rawSteps, rawQueue] = await Promise.all([
          AsyncStorage.getItem(STEPS_KEY),
          AsyncStorage.getItem(QUEUE_KEY),
        ]);
        const saved = rawSteps ? JSON.parse(rawSteps) : null;
        if (saved && typeof saved.steps === 'number') {
          tracker.current = saved;
          if (saved.day === todayIst()) {
            setLocalSteps(saved.steps);
          }
        }
        const queued = rawQueue ? JSON.parse(rawQueue) : null;
        if (queued && Array.isArray(queued.queue)) {
          // what was waiting when the app was closed goes out now (a half-filled batch is closed first)
          batches.current = closeOpen(queued, new Date().toISOString());
          flush();
        }
      } catch {
        // nothing saved: start from zero
      }
      if (!(await isStepCounterSupported())) {
        setStepStatus('unsupported');
        return;
      }
      if (!(await hasStepPermission())) {
        setStepStatus('off');
        return;
      }
      setStepStatus((await begin()) ? 'on' : 'unsupported');
    })();
    const appState = AppState.addEventListener('change', next => {
      if (next !== 'active') {
        closeIfDue(true);
      }
    });
    const tick = setInterval(() => {
      closeIfDue(false);
      flush();
    }, TICK_MS);
    const recentTimer = setInterval(loadRecent, RECENT_EVERY_MS);
    loadRecent();
    return () => {
      appState.remove();
      clearInterval(tick);
      clearInterval(recentTimer);
      closeIfDue(true);
      persist(true);
      stopUpdates.current?.();
      stopUpdates.current = null;
    };
  }, [begin, persist, closeIfDue, flush, loadRecent]);

  // The person taps "Turn on step counting": ask for the permission, then start
  const enableSteps = useCallback(async () => {
    if (!(await isStepCounterSupported())) {
      setStepStatus('unsupported');
      return;
    }
    if (!(await requestStepPermission())) {
      setStepStatus('denied');
      return;
    }
    setStepStatus((await begin()) ? 'on' : 'unsupported');
  }, [begin]);

  // The server may know more steps than this phone (a reinstall, another phone): never show fewer
  const serverSteps = today?.steps?.count ?? 0;
  const steps = Math.max(localSteps, serverSteps);

  // ---------------------------------------------------------------- walk mode
  const [walk, setWalk] = useState(null); // { startedAt (ms), startSteps }
  const [lastWalk, setLastWalk] = useState(null); // the walk saved last, for the summary
  const stepsRef = useRef(0);
  stepsRef.current = steps;

  const startWalk = useCallback(() => {
    setLastWalk(null);
    setWalk({ startedAt: Date.now(), startSteps: stepsRef.current });
  }, []);

  // Ends the walk and saves it. Resolves the saved walk, or null when it was too short to count.
  const stopWalk = useCallback(async () => {
    const current = walk;
    setWalk(null);
    if (!current) {
      return null;
    }
    const durationSec = Math.round((Date.now() - current.startedAt) / 1000);
    const walked = Math.max(0, stepsRef.current - current.startSteps);
    if (durationSec < MIN_WALK_SECONDS) {
      return null;
    }
    try {
      const saved = await addWalk({
        startedAt: new Date(current.startedAt).toISOString(),
        durationSec,
        steps: walked,
      });
      setLastWalk(saved);
      return saved;
    } catch (e) {
      setError(e);
      throw e;
    }
  }, [walk]);

  const value = useMemo(
    () => ({
      today,
      status,
      error,
      refresh: load,
      addWater,
      setMood,
      updateSettings,
      notifications,
      enableNotifications,
      sendTestReminder,
      stepStatus,
      steps,
      recentSteps,
      enableSteps,
      walk,
      lastWalk,
      startWalk,
      stopWalk,
    }),
    [
      today,
      status,
      error,
      load,
      addWater,
      setMood,
      updateSettings,
      notifications,
      enableNotifications,
      sendTestReminder,
      stepStatus,
      steps,
      recentSteps,
      enableSteps,
      walk,
      lastWalk,
      startWalk,
      stopWalk,
    ],
  );

  return (
    <WellnessContext.Provider value={value}>
      {children}
    </WellnessContext.Provider>
  );
}

export function useWellness() {
  const ctx = useContext(WellnessContext);
  if (!ctx) {
    throw new Error('useWellness must be used inside WellnessProvider');
  }
  return ctx;
}
