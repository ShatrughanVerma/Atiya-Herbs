import {PermissionsAndroid, Platform} from 'react-native';

// Asks for the microphone (and the camera for video calls). Bluetooth is optional: it only
// lets the call play through a Bluetooth headset, so a "no" doesn't stop the call.
export async function ensureCallPermissions(video) {
  if (Platform.OS !== 'android') {
    return true; // iOS asks by itself the first time the call opens the mic or camera
  }
  const {PERMISSIONS, RESULTS} = PermissionsAndroid;
  const required = video ? [PERMISSIONS.RECORD_AUDIO, PERMISSIONS.CAMERA] : [PERMISSIONS.RECORD_AUDIO];
  const optional = Platform.Version >= 31 ? [PERMISSIONS.BLUETOOTH_CONNECT] : [];
  const result = await PermissionsAndroid.requestMultiple([...required, ...optional]);
  return required.every(p => result[p] === RESULTS.GRANTED);
}
