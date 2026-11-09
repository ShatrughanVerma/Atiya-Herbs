import {Alert} from 'react-native';
import {launchImageLibrary} from 'react-native-image-picker';
import {isSupportedVideo} from '../utils/doctor';

// Opens the phone's gallery to choose ONE video (the one made earlier with the camera app).
// Resolves with {uri, type, name, size, duration}, or null when the doctor goes back or the choice is not usable.
export async function pickVideoFromGallery() {
  const result = await launchImageLibrary({mediaType: 'video', selectionLimit: 1});
  if (result.didCancel) {
    return null;
  }
  if (result.errorCode) {
    Alert.alert('Video', 'Could not open the gallery. Please try again.');
    return null;
  }
  const asset = result.assets?.[0];
  if (!asset?.uri) {
    return null;
  }
  if (!isSupportedVideo(asset.type)) {
    Alert.alert('Video', 'This video format is not supported. Please choose an MP4 video.');
    return null;
  }
  return {uri: asset.uri, type: asset.type, name: asset.fileName || 'visit.mp4', size: asset.fileSize, duration: asset.duration};
}
