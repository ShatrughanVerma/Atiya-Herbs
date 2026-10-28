/* eslint-env jest */
// LiveKit's call libraries need the phone's native WebRTC code, so tests use these empty stand-ins.
// Tests that exercise calls (__tests__/CallContext.test.js) replace them with richer fakes.
jest.mock('@livekit/react-native', () => ({
  registerGlobals: jest.fn(),
  AudioSession: {
    startAudioSession: jest.fn(async () => {}),
    stopAudioSession: jest.fn(async () => {}),
    selectAudioOutput: jest.fn(async () => {}),
  },
  VideoTrack: 'VideoTrack',
}));

jest.mock('livekit-client', () => ({
  Room: class {},
  RoomEvent: {},
  Track: {Source: {Camera: 'camera'}},
}));
