import {Platform} from 'react-native';

// Address of the Atiya Herbs API (the backend/ folder): login with a password, profile, shop, orders.
//
// TODO (before the Play Store release): replace PRODUCTION_API_URL with the real https:// address of the
// deployed backend. Android blocks plain http outside the localhost exceptions in network_security_config.xml.
const PRODUCTION_API_URL = 'http://localhost:4100/api/v1';

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
