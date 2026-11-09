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

// AsyncStorage needs the phone's native storage; this keeps it in memory for tests
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('livekit-client', () => ({
  Room: class {},
  RoomEvent: {},
  Track: {Source: {Camera: 'camera'}},
}));

// Agora's call engine is native code; calling tests that need it replace this with a richer fake
jest.mock('react-native-agora', () => ({
  createAgoraRtcEngine: jest.fn(),
  ChannelProfileType: {ChannelProfileCommunication: 0},
  ClientRoleType: {ClientRoleBroadcaster: 1},
  ConnectionStateType: {ConnectionStateConnected: 3, ConnectionStateReconnecting: 4, ConnectionStateFailed: 5},
  RemoteAudioState: {RemoteAudioStateStopped: 0, RemoteAudioStateDecoding: 2},
  RemoteVideoState: {RemoteVideoStateStopped: 0, RemoteVideoStateDecoding: 2},
  RenderModeType: {RenderModeHidden: 1},
  VideoMirrorModeType: {VideoMirrorModeEnabled: 1, VideoMirrorModeDisabled: 2},
  RtcSurfaceView: 'RtcSurfaceView',
}));

// The login tokens go to the Android Keystore through react-native-keychain (native code); tests keep them in memory
jest.mock('react-native-keychain', () => {
  const store = new Map();
  return {
    setGenericPassword: jest.fn(async (username, password, options = {}) => {
      store.set(options.service || 'default', {username, password});
      return {service: options.service || 'default', storage: 'mock'};
    }),
    getGenericPassword: jest.fn(async (options = {}) => store.get(options.service || 'default') || false),
    resetGenericPassword: jest.fn(async (options = {}) => store.delete(options.service || 'default')),
    __store: store,
  };
});
