import AsyncStorage from '@react-native-async-storage/async-storage';

// Remembers where the doctor stopped watching a video (per video id), so that opening it again carries on from there
// and not from the start. It is kept on this phone only. Everything is wrapped: a storage problem never stops a video.

const keyOf = videoId => `video-resume:${videoId}`;
const MIN_SECONDS = 3; // closer to the start than this: just start from the beginning
const END_MARGIN = 5; // closer to the end than this: the video was watched, start again

export async function saveVideoPosition(videoId, seconds) {
  try {
    if (!videoId || !Number.isFinite(seconds) || seconds < MIN_SECONDS) {
      return;
    }
    await AsyncStorage.setItem(keyOf(videoId), String(Math.floor(seconds)));
  } catch {
    // not saving is fine
  }
}

// -> the second to start from (0 when there is nothing worth resuming)
export async function loadVideoPosition(videoId, duration) {
  try {
    const seconds = Number(await AsyncStorage.getItem(keyOf(videoId)));
    if (!Number.isFinite(seconds) || seconds < MIN_SECONDS) {
      return 0;
    }
    if (Number.isFinite(duration) && duration > 0 && seconds > duration - END_MARGIN) {
      return 0;
    }
    return seconds;
  } catch {
    return 0;
  }
}

export async function clearVideoPosition(videoId) {
  try {
    await AsyncStorage.removeItem(keyOf(videoId));
  } catch {
    // nothing to do
  }
}
