import {Platform} from 'react-native';

// Address of the Atiya Herbs API (the backend/ folder): login with a password, profile, shop, orders.
//
// PRODUCTION_API_URL is the deployed backend on Render (https, so Android allows it). Phones and release builds use it,
// no USB cable needed. The free Render plan sleeps when idle, so the first request after a pause can take about a minute.
const PRODUCTION_API_URL = 'https://atiya-herbs.onrender.com/api/v1';

// On the Android emulator the PC is 10.0.2.2. A real phone reaches the PC's backend through USB with
//   adb reverse tcp:4100 tcp:4100
// which makes "localhost" on the phone mean the PC.
const info = Platform.OS === 'android' ? Platform.constants || {} : {};
const onEmulator = /sdk|emulator|generic|goldfish|ranchu/i.test(
  `${info.Model || ''} ${info.Fingerprint || ''}`,
);

export const API_BASE_URL =
  __DEV__ && onEmulator ? 'http://10.0.2.2:4100/api/v1' : PRODUCTION_API_URL;
export const API_TIMEOUT_MS = 15000;

// Google Maps key for clinic distances that match what Google Maps shows (Distance Matrix API).
// Leave it empty to use the free routing server instead (close to Google, usually a few percent lower).
// Make the key in Google Cloud, enable "Distance Matrix API", and RESTRICT it (Android app com.atiyaherbs with the
// app's SHA-1, and only that API): a key inside an app can be read by anyone who unpacks the APK.
export const GOOGLE_MAPS_API_KEY = '';
