import * as Keychain from 'react-native-keychain';

// The login tokens live in the Android Keystore (through react-native-keychain), never in AsyncStorage, which is
// plain unencrypted storage. Both tokens go in one entry so they are always written and read together.
const SERVICE = 'atiya.auth.tokens.v1';

export async function saveTokens({ accessToken, refreshToken }) {
  await Keychain.setGenericPassword(
    'tokens',
    JSON.stringify({ accessToken, refreshToken }),
    { service: SERVICE },
  );
}

// {accessToken, refreshToken}, or null when nothing is saved (or the saved data is damaged / the Keystore fails)
export async function loadTokens() {
  try {
    const entry = await Keychain.getGenericPassword({ service: SERVICE });
    if (!entry) {
      return null;
    }
    const data = JSON.parse(entry.password);
    return typeof data?.accessToken === 'string' &&
      typeof data?.refreshToken === 'string'
      ? data
      : null;
  } catch {
    return null;
  }
}

export async function clearTokens() {
  try {
    await Keychain.resetGenericPassword({ service: SERVICE });
  } catch {
    // nothing to clear
  }
}
