import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearVideoPosition, loadVideoPosition, saveVideoPosition } from '../src/utils/videoResume';

beforeEach(() => AsyncStorage.clear());

test('a video carries on from where it was stopped', async () => {
  await saveVideoPosition('v1', 83.7);
  expect(await loadVideoPosition('v1', 600)).toBe(83);
  expect(await loadVideoPosition('v2', 600)).toBe(0); // another video starts from the beginning
});

test('the first seconds and a finished video start from the beginning', async () => {
  await saveVideoPosition('v1', 2);
  expect(await loadVideoPosition('v1', 600)).toBe(0);
  await saveVideoPosition('v1', 598);
  expect(await loadVideoPosition('v1', 600)).toBe(0);
});

test('clearing forgets the place, and bad values are ignored', async () => {
  await saveVideoPosition('v1', 50);
  await clearVideoPosition('v1');
  expect(await loadVideoPosition('v1', 600)).toBe(0);
  await saveVideoPosition('v1', NaN);
  await saveVideoPosition(undefined, 50);
  expect(await loadVideoPosition('v1', 600)).toBe(0);
});
