import {
  NativeEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Platform,
} from 'react-native';

// Live steps from the phone's own step counter (android/.../steps/StepCounterModule.kt).
// The sensor's number is the total since the phone was last restarted; src/wellness/utils/stepMath.js turns it into
// the steps of today.
const { StepCounter } = NativeModules;
const emitter = StepCounter ? new NativeEventEmitter(StepCounter) : null;

// Does this phone have a step counter?
export async function isStepCounterSupported() {
  if (Platform.OS !== 'android' || !StepCounter) {
    return false;
  }
  try {
    return !!(await StepCounter.isSupported());
  } catch {
    return false;
  }
}

// Android 10 and later ask for "Physical activity"; older Android needs no question
export async function hasStepPermission() {
  if (Platform.OS !== 'android') {
    return false;
  }
  if (Platform.Version < 29) {
    return true;
  }
  return PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION,
  );
}

export async function requestStepPermission() {
  if (Platform.OS !== 'android') {
    return false;
  }
  if (Platform.Version < 29) {
    return true;
  }
  const answer = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION,
    {
      title: 'Count your steps',
      message:
        "Atiya Herbs uses your phone's step counter to show your steps and walks. Nothing else is read.",
      buttonPositive: 'Allow',
      buttonNegative: 'Not now',
    },
  );
  return answer === PermissionsAndroid.RESULTS.GRANTED;
}

// Calls onSteps(total) now and for every new reading. Returns a function that stops the updates, or null when the
// phone cannot count steps.
export async function startStepUpdates(onSteps) {
  if (!StepCounter || !emitter) {
    return null;
  }
  const subscription = emitter.addListener('StepCounterUpdate', event =>
    onSteps(event.steps),
  );
  let started = false;
  try {
    started = await StepCounter.start();
  } catch {
    started = false;
  }
  if (!started) {
    subscription.remove();
    return null;
  }
  return () => {
    subscription.remove();
    StepCounter.stop();
  };
}
