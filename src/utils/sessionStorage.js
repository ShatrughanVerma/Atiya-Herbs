import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'atiya.session.v1';

// AsyncStorage is plain, unencrypted storage, so only the customer's profile is kept here.
// Passwords and login tokens must never go in it (tokens belong in the Android Keystore, e.g. react-native-keychain).
const PROFILE_FIELDS = ['name', 'email', 'mobile', 'gender', 'photo', 'provider', 'role'];

const pickProfile = data => {
  const profile = {};
  for (const field of PROFILE_FIELDS) {
    if (typeof data[field] === 'string' && data[field].length <= 2048) {
      profile[field] = data[field];
    }
  }
  return profile;
};

// Returns the saved profile, or null when nobody is signed in (or the saved data is damaged)
export async function loadSession() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) {
      return null;
    }
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || typeof data.name !== 'string' || !data.name) {
      return null;
    }
    return pickProfile(data);
  } catch {
    return null;
  }
}

export async function saveSession(user) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(pickProfile(user)));
  } catch {
    // The user stays signed in for this session; only remembering them next time failed
  }
}

export async function clearSession() {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Nothing to clear if storage is unavailable
  }
}
