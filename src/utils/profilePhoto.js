import {Alert, PermissionsAndroid, Platform} from 'react-native';
import {launchCamera, launchImageLibrary} from 'react-native-image-picker';

// The manifest declares CAMERA, so Android only opens the camera once it is granted at runtime
const ensureCameraPermission = async () => {
  if (Platform.OS !== 'android') {
    return true;
  }
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
  return result === PermissionsAndroid.RESULTS.GRANTED;
};

const pickPhoto = async (fromCamera, onPicked) => {
  if (fromCamera && !(await ensureCameraPermission())) {
    Alert.alert('Profile photo', 'Please allow camera access in Settings.');
    return;
  }
  const options = {mediaType: 'photo', maxWidth: 512, maxHeight: 512, quality: 0.8};
  const result = fromCamera
    ? await launchCamera({...options, cameraType: 'front', saveToPhotos: false})
    : await launchImageLibrary({...options, selectionLimit: 1});
  if (result.didCancel) {
    return;
  }
  if (result.errorCode) {
    Alert.alert(
      'Profile photo',
      result.errorCode === 'camera_unavailable'
        ? 'Camera is not available on this device.'
        : result.errorCode === 'permission'
        ? 'Please allow camera / photo access in Settings.'
        : 'Could not get the photo. Please try again.',
    );
    return;
  }
  const uri = result.assets?.[0]?.uri;
  if (uri) {
    onPicked(uri);
  }
};

/**
 * Shows the Take photo / Choose from gallery / Remove menu.
 * Calls onChange with the new photo uri, or null when the photo is removed.
 */
export function chooseProfilePhoto(hasPhoto, onChange) {
  const buttons = [
    {text: 'Take photo', onPress: () => pickPhoto(true, onChange)},
    {text: 'Choose from gallery', onPress: () => pickPhoto(false, onChange)},
  ];
  if (hasPhoto) {
    buttons.push({text: 'Remove photo', style: 'destructive', onPress: () => onChange(null)});
  }
  buttons.push({text: 'Cancel', style: 'cancel'});
  Alert.alert('Profile photo', undefined, buttons);
}
