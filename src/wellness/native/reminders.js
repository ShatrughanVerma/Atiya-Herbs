import { NativeModules, PermissionsAndroid, Platform } from 'react-native';

// Reminders of Health Wellness as daily alarms and notifications (android/.../reminders/RemindersModule.kt).
const { Reminders } = NativeModules;

export const remindersSupported = Platform.OS === 'android' && !!Reminders;

// Android 13 and later ask before notifications may be shown; older Android never asks
export async function notificationsAllowed() {
  if (!remindersSupported) {
    return false;
  }
  try {
    return !!(await Reminders.notificationsEnabled());
  } catch {
    return false;
  }
}

// Asks the person (only Android 13+ has a question). Resolves true when notifications are on afterwards.
export async function requestNotifications() {
  if (!remindersSupported) {
    return false;
  }
  if (Platform.Version >= 33) {
    await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
  }
  return notificationsAllowed();
}

// false on Android 12+ until "Alarms & reminders" is allowed for the app: alarms may then come a few minutes late
export async function canRingOnTime() {
  if (!remindersSupported) {
    return true;
  }
  try {
    return !!(await Reminders.canScheduleExact());
  } catch {
    return true;
  }
}

// Replaces every reminder: [{ id, hour, minute, title, body }]
export const setReminders = list =>
  remindersSupported ? Reminders.replaceAll(list) : Promise.resolve(0);

export const clearReminders = () =>
  remindersSupported ? Reminders.cancelAll() : Promise.resolve();

export const showTestReminder = (title, body) =>
  remindersSupported ? Reminders.sendTest(title, body) : Promise.resolve();

export const openAlarmSettings = () =>
  remindersSupported ? Reminders.openExactAlarmSettings() : Promise.resolve();

export const openNotificationSettings = () =>
  remindersSupported
    ? Reminders.openNotificationSettings()
    : Promise.resolve();

// The system time picker. minutes = minutes after midnight. Resolves the chosen minutes, or null when cancelled.
export async function pickMinutes(minutes) {
  if (!remindersSupported) {
    return null;
  }
  const picked = await Reminders.pickTime(
    Math.floor(minutes / 60),
    minutes % 60,
  );
  return picked ? picked.hour * 60 + picked.minute : null;
}
