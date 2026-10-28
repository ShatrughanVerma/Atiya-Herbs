import {NativeModules, Platform} from 'react-native';

// Opens the phone's own contact picker (android/.../calls/ContactPickerModule.kt). The user
// picks one number, so the app needs no permission to read the whole contact list.
const {ContactPicker} = NativeModules;

export const isContactPickerAvailable = Platform.OS === 'android' && !!ContactPicker;

// Resolves to {name, number}, or null if the user backed out
export async function pickContactNumber() {
  if (!isContactPickerAvailable) {
    return null;
  }
  return ContactPicker.pickPhoneNumber();
}
