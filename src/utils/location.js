import {PermissionsAndroid, Platform} from 'react-native';

const LOCATION_OFF_MESSAGE =
  'Could not find your location. Switch on Location (with Wi-Fi on, or precise location) and try again.';

// Loaded on first use so a build without the native module can't crash the screen that imports this file
let Geolocation = null;
const loadGeolocation = () => {
  if (!Geolocation) {
    try {
      Geolocation = require('@react-native-community/geolocation').default;
    } catch {
      throw new Error('Location is not available in this version of the app. Please update the app.');
    }
  }
  return Geolocation;
};

async function ensurePermission() {
  if (Platform.OS === 'android') {
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }
  return new Promise(resolve =>
    Geolocation.requestAuthorization(
      () => resolve(true),
      () => resolve(false),
    ),
  );
}

const getPosition = highAccuracy =>
  new Promise((resolve, reject) =>
    Geolocation.getCurrentPosition(
      pos => resolve({lat: pos.coords.latitude, lng: pos.coords.longitude}),
      reject,
      {enableHighAccuracy: highAccuracy, timeout: highAccuracy ? 15000 : 8000, maximumAge: 10 * 60 * 1000},
    ),
  );

/**
 * Resolves to {lat, lng}.
 * Rejects with an Error whose message is safe to show to the user.
 */
export async function getCurrentLocation() {
  loadGeolocation();
  if (!(await ensurePermission())) {
    throw new Error('Allow location access to see the clinics nearest to you.');
  }
  try {
    // A quick network fix is enough to pick the nearest city; fall back to GPS if it fails
    return await getPosition(false);
  } catch {
    try {
      return await getPosition(true);
    } catch {
      throw new Error(LOCATION_OFF_MESSAGE);
    }
  }
}

/** Straight-line distance in km between two {lat, lng} points. */
export function distanceKm(a, b) {
  const rad = d => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
