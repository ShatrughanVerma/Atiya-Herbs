import React, { useEffect } from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Alert, Modal, Platform, Vibration } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AudioSession } from '@livekit/react-native';
import { Room as FakeRoom } from 'livekit-client';
import { createAgoraRtcEngine } from 'react-native-agora';
import { AuthProvider, useAuth } from '../../src/context/AuthContext';
import {
  CallProvider,
  callUserId,
  useCall,
} from '../../src/calling/CallContext';
import CallOverlay from '../../src/calling/CallOverlay';

// The first render loads the whole screen and its icon fonts, which is slow when tests run in parallel
jest.setTimeout(30000);

// A fake Socket.IO connection: records what the app sends and lets the test play the server
jest.mock('socket.io-client', () => ({
  io: jest.fn((url, opts) => {
    const handlers = {};
    const socket = {
      opts,
      connected: true,
      sent: [],
      on: (event, fn) => (handlers[event] = fn),
      emit: (event, payload, ack) => socket.sent.push({ event, payload, ack }),
      disconnect: jest.fn(),
      serverSends: (event, payload) => handlers[event]?.(payload),
    };
    global.fakeSocket = socket;
    return socket;
  }),
}));

// A fake LiveKit room: the test decides who joins and what they publish
jest.mock('livekit-client', () => {
  class Room {
    constructor() {
      this.handlers = {};
      this.remoteParticipants = new Map();
      this.cameraPublication = null;
      this.connect = jest.fn(async () => {
        if (Room.failConnect) {
          throw new Error('LiveKit refused the connection');
        }
      });
      this.disconnect = jest.fn(async () => {});
      this.localParticipant = {
        isCameraEnabled: false,
        setMicrophoneEnabled: jest.fn(async () => {}),
        setCameraEnabled: jest.fn(async on => {
          this.localParticipant.isCameraEnabled = on;
          this.cameraPublication = on
            ? {
                track: { restartTrack: jest.fn(async () => {}) },
                isMuted: false,
              }
            : null;
        }),
        getTrackPublication: () => this.cameraPublication,
      };
      Room.last = this;
    }
    on(event, fn) {
      this.handlers[event] = fn;
      return this;
    }
    removeAllListeners() {
      this.handlers = {};
    }
    fire(event, ...args) {
      this.handlers[event]?.(...args);
    }
  }
  const RoomEvent = Object.fromEntries(
    [
      'ParticipantConnected',
      'ParticipantDisconnected',
      'TrackSubscribed',
      'TrackUnsubscribed',
      'TrackMuted',
      'TrackUnmuted',
      'LocalTrackPublished',
      'LocalTrackUnpublished',
      'Reconnecting',
      'Reconnected',
      'Disconnected',
    ].map(name => [name, name]),
  );
  return { Room, RoomEvent, Track: { Source: { Camera: 'camera' } } };
});

jest.mock('@livekit/react-native', () => ({
  AudioSession: {
    startAudioSession: jest.fn(async () => {}),
    stopAudioSession: jest.fn(async () => {}),
    selectAudioOutput: jest.fn(async () => {}),
  },
  VideoTrack: 'VideoTrack',
}));

// LiveKit names the audio outputs differently on iOS and Android
const EARPIECE = Platform.OS === 'ios' ? 'default' : 'earpiece';
const SPEAKER = Platform.OS === 'ios' ? 'force_speaker' : 'speaker';

const SAFE_AREA = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 40, left: 0, right: 0, bottom: 20 },
};
const ME = { name: 'Asha', mobile: '+91 98765-43210' }; // call id 9876543210
const BILAL = { id: '9123456780', name: 'Bilal' };
const READY = {
  callId: 'c1',
  serverUrl: 'wss://example.livekit.cloud',
  token: 'jwt-token',
};

let api;
let screen;
function Probe({ user }) {
  const { signIn } = useAuth();
  api = useCall();
  useEffect(() => signIn(user), [signIn, user]);
  return null;
}

const render = async (user = ME) => {
  await ReactTestRenderer.act(async () => {
    screen = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={SAFE_AREA}>
        <AuthProvider>
          <CallProvider>
            <Probe user={user} />
            <CallOverlay />
          </CallProvider>
        </AuthProvider>
      </SafeAreaProvider>,
    );
  });
  return global.fakeSocket;
};

const flush = () => new Promise(resolve => setImmediate(resolve));
const act = fn =>
  ReactTestRenderer.act(async () => {
    await fn();
    await flush();
    await flush();
  });
const button = label =>
  screen.root.find(
    n => n.props.accessibilityLabel === label && n.props.onPress,
  );
const sent = (socket, event) => socket.sent.filter(s => s.event === event);

// The other person: a LiveKit participant with the mic on and no camera
const remotePerson = () => {
  const person = {
    isMicrophoneEnabled: true,
    isCameraEnabled: false,
    getTrackPublication: () => null,
  };
  return person;
};

// Calls Bilal, he picks up (server sends call:ready) and joins the room
const connectedOutgoingCall = async video => {
  const socket = await render();
  await act(() => api.startCall(BILAL, video));
  await act(() =>
    sent(socket, 'call:start')[0].ack({ ok: true, callId: 'c1' }),
  );
  await act(() => socket.serverSends('call:ready', READY));
  const room = FakeRoom.last;
  room.remoteParticipants.set('bilal', remotePerson());
  await act(() => room.fire('ParticipantConnected'));
  return { socket, room };
};

beforeEach(() => {
  jest.clearAllMocks();
  FakeRoom.failConnect = false;
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(Vibration, 'vibrate').mockImplementation(() => {});
  FakeRoom.last = null;
});
afterEach(async () => {
  await act(() => screen?.unmount());
  jest.restoreAllMocks();
});

test('the call id is the 10-digit mobile number, whatever format it was saved in', () => {
  expect(callUserId({ mobile: '9876543210' })).toBe('9876543210');
  expect(callUserId({ mobile: '+91 98765-43210', email: 'a@x.com' })).toBe(
    '9876543210',
  );
  expect(callUserId({ email: 'a@x.com', name: 'Asha' })).toBe(''); // no mobile number: can't call
  expect(callUserId(null)).toBe('');
});

test('connects as the logged-in user and lists everyone else online', async () => {
  const socket = await render();
  expect(socket.opts.auth).toEqual({ userId: '9876543210', name: 'Asha' });

  await act(() =>
    socket.serverSends('users', [
      { id: '9876543210', name: 'Asha' },
      { id: BILAL.id, name: 'Bilal' },
    ]),
  );
  expect(api.onlineUsers).toEqual([{ id: BILAL.id, name: 'Bilal' }]);
});

test('a user without a mobile number never connects', async () => {
  global.fakeSocket = null;
  await render({ name: 'Asha', email: 'a@x.com' });
  expect(global.fakeSocket).toBeNull();
});

test('outgoing voice call: rings, joins the LiveKit room when accepted, connects and ends', async () => {
  const socket = await render();
  await act(() => api.startCall(BILAL, false));
  expect(sent(socket, 'call:start')[0].payload).toEqual({
    to: BILAL.id,
    video: false,
  });
  expect(api.call).toMatchObject({
    status: 'calling',
    direction: 'outgoing',
    peer: BILAL,
  });
  expect(screen.root.findAllByType(Modal)).toHaveLength(1);

  await act(() =>
    sent(socket, 'call:start')[0].ack({ ok: true, callId: 'c1' }),
  );
  expect(api.call).toMatchObject({ id: 'c1', status: 'ringing' });

  await act(() => socket.serverSends('call:ready', READY));
  const room = FakeRoom.last;
  expect(room.connect).toHaveBeenCalledWith(READY.serverUrl, READY.token);
  expect(AudioSession.startAudioSession).toHaveBeenCalled();
  expect(AudioSession.selectAudioOutput).toHaveBeenLastCalledWith(EARPIECE); // voice calls start on the earpiece
  expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
  expect(room.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
  expect(api.call.status).toBe('connecting'); // waiting for the other person to join

  room.remoteParticipants.set('bilal', remotePerson());
  await act(() => room.fire('ParticipantConnected'));
  expect(api.call.status).toBe('connected');
  expect(api.call.connectedAt).toBeGreaterThan(0);

  await act(() => button('End call').props.onPress());
  expect(sent(socket, 'call:end')[0].payload).toEqual({ callId: 'c1' });
  expect(room.disconnect).toHaveBeenCalled();
  expect(AudioSession.stopAudioSession).toHaveBeenCalled();
  expect(api.history[0]).toMatchObject({
    peer: BILAL,
    direction: 'outgoing',
    outcome: 'answered',
    video: false,
  });
});

test('a video call turns the camera on and starts on the loudspeaker', async () => {
  const { room } = await connectedOutgoingCall(true);
  expect(room.localParticipant.setCameraEnabled).toHaveBeenCalledWith(true, {
    facingMode: 'user',
  });
  expect(AudioSession.selectAudioOutput).toHaveBeenLastCalledWith(SPEAKER);
  expect(api.cameraOn).toBe(true);
  expect(api.localVideo).toMatchObject({ source: 'camera' });

  await act(() => button('Switch camera').props.onPress());
  expect(room.cameraPublication.track.restartTrack).toHaveBeenCalledWith({
    facingMode: 'environment',
  });
  expect(api.frontCamera).toBe(false);
});

test('mute, speaker and the camera button (which turns a voice call into video) work during a call', async () => {
  const { room } = await connectedOutgoingCall(false);

  await act(() => button('Mute').props.onPress());
  expect(api.muted).toBe(true);
  expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(
    false,
  );

  await act(() => button('Speaker').props.onPress());
  expect(api.speakerOn).toBe(true);
  expect(AudioSession.selectAudioOutput).toHaveBeenLastCalledWith(SPEAKER);

  await act(() => button('Turn camera on').props.onPress());
  expect(room.localParticipant.setCameraEnabled).toHaveBeenLastCalledWith(
    true,
    { facingMode: 'user' },
  );
  expect(api.call.video).toBe(true);
  expect(api.cameraOn).toBe(true);

  await act(() => button('Turn camera off').props.onPress());
  expect(room.localParticipant.setCameraEnabled).toHaveBeenLastCalledWith(
    false,
    undefined,
  );
  expect(api.cameraOn).toBe(false);
});

test('shows when the other person is muted or has their camera off', async () => {
  const { room } = await connectedOutgoingCall(false);
  const remote = room.remoteParticipants.get('bilal');
  remote.isMicrophoneEnabled = false;
  await act(() => room.fire('TrackMuted'));
  expect(api.peerMedia).toEqual({ muted: true, videoOff: true });
});

test('incoming call: vibrates, accepting asks the server, and the room is joined on call:ready', async () => {
  const socket = await render();
  await act(() =>
    socket.serverSends('call:incoming', {
      callId: 'c1',
      from: BILAL,
      video: false,
    }),
  );
  expect(api.call).toMatchObject({
    status: 'ringing',
    direction: 'incoming',
    peer: BILAL,
  });
  expect(Vibration.vibrate).toHaveBeenCalled();

  await act(() => button('Accept').props.onPress());
  expect(Vibration.cancel).toHaveBeenCalled();
  expect(sent(socket, 'call:accept')[0].payload).toEqual({ callId: 'c1' });
  expect(api.call.status).toBe('connecting');

  await act(() => socket.serverSends('call:ready', READY));
  expect(FakeRoom.last.connect).toHaveBeenCalledWith(
    READY.serverUrl,
    READY.token,
  );

  // The caller hangs up: the screen shows why, and it is logged
  await act(() =>
    socket.serverSends('call:ended', { callId: 'c1', reason: 'ended' }),
  );
  expect(api.call).toMatchObject({ status: 'ended', endText: 'Call ended' });
  expect(FakeRoom.last.disconnect).toHaveBeenCalled();
});

test('declining an incoming call tells the server and logs it', async () => {
  const socket = await render();
  await act(() =>
    socket.serverSends('call:incoming', {
      callId: 'c2',
      from: BILAL,
      video: true,
    }),
  );
  await act(() => button('Decline').props.onPress());
  expect(sent(socket, 'call:reject')[0].payload).toEqual({ callId: 'c2' });
  expect(api.history[0]).toMatchObject({
    direction: 'incoming',
    outcome: 'declined',
    video: true,
  });
  expect(FakeRoom.last).toBeNull(); // never joined LiveKit
});

test('a missed call and an unanswered call are logged with the right outcome', async () => {
  const socket = await render();
  await act(() =>
    socket.serverSends('call:incoming', {
      callId: 'c3',
      from: BILAL,
      video: false,
    }),
  );
  await act(() =>
    socket.serverSends('call:ended', { callId: 'c3', reason: 'cancelled' }),
  );
  expect(api.call.endText).toBe('Missed call');
  expect(api.history[0]).toMatchObject({
    direction: 'incoming',
    outcome: 'missed',
  });
});

test('tells the user why a call could not start', async () => {
  const socket = await render();
  await act(() => api.startCall(BILAL, false));
  await act(() =>
    sent(socket, 'call:start')[0].ack({ ok: false, error: 'offline' }),
  );
  expect(Alert.alert).toHaveBeenCalledWith(
    'Calls',
    expect.stringContaining('Bilal is not using Atiya Herbs'),
  );
  expect(api.call).toBeNull();
  expect(api.history).toHaveLength(0); // it never started, so it is not logged
});

const byLabelOrNull = label =>
  screen.root.findAll(n => n.props.accessibilityLabel === label);

test('the Record button appears only when the server can record and the call is connected', async () => {
  const { socket } = await connectedOutgoingCall(false);
  expect(byLabelOrNull('Record call')).toHaveLength(0); // the server hasn't said it can record

  await act(() =>
    socket.serverSends('session', {
      activeCallId: 'c1',
      recordingAvailable: true,
    }),
  );
  expect(api.recordingAvailable).toBe(true);
  expect(byLabelOrNull('Record call').length).toBeGreaterThan(0);
});

test('recording starts only after the other person allows it, and either side can stop it', async () => {
  const { socket } = await connectedOutgoingCall(false);
  await act(() =>
    socket.serverSends('session', {
      activeCallId: 'c1',
      recordingAvailable: true,
    }),
  );

  await act(() => button('Record call').props.onPress());
  expect(sent(socket, 'recording:request')[0].payload).toEqual({
    callId: 'c1',
  });
  expect(api.recording).toBe('asking'); // waiting: nothing is recording yet
  expect(byLabelOrNull('Recording')).toHaveLength(0);

  await act(() => sent(socket, 'recording:request')[0].ack({ ok: true }));
  await act(() =>
    socket.serverSends('recording:state', { callId: 'c1', state: 'on' }),
  );
  expect(api.recording).toBe('on');
  expect(byLabelOrNull('Recording').length).toBeGreaterThan(0); // the red "Recording" badge

  await act(() => button('Stop recording').props.onPress());
  expect(sent(socket, 'recording:stop')[0].payload).toEqual({ callId: 'c1' });
  expect(api.recording).toBe('off');
});

test('if they say no, or the server refuses, the user is told and nothing records', async () => {
  const { socket } = await connectedOutgoingCall(false);
  await act(() =>
    socket.serverSends('session', {
      activeCallId: 'c1',
      recordingAvailable: true,
    }),
  );

  await act(() => button('Record call').props.onPress());
  await act(() =>
    socket.serverSends('recording:state', {
      callId: 'c1',
      state: 'off',
      reason: 'declined',
    }),
  );
  expect(api.recording).toBe('off');
  expect(Alert.alert).toHaveBeenCalledWith(
    'Recording',
    'They chose not to record this call.',
  );

  await act(() => button('Record call').props.onPress());
  await act(() =>
    sent(socket, 'recording:request')[1].ack({ ok: false, error: 'quota' }),
  );
  expect(api.recording).toBe('off');
  expect(Alert.alert).toHaveBeenLastCalledWith(
    'Recording',
    expect.stringContaining('free recording time is used up'),
  );
});

test('when the other person asks to record, we see who asked and must choose Allow or Not now', async () => {
  const { socket } = await connectedOutgoingCall(false);
  await act(() =>
    socket.serverSends('recording:requested', { callId: 'c1', from: BILAL }),
  );
  expect(api.recordingRequest).toEqual({ from: BILAL });
  expect(byLabelOrNull('Allow recording').length).toBeGreaterThan(0);

  await act(() => button('Do not allow recording').props.onPress());
  expect(sent(socket, 'recording:respond')[0].payload).toEqual({
    callId: 'c1',
    allow: false,
  });
  expect(api.recordingRequest).toBeNull();

  await act(() =>
    socket.serverSends('recording:requested', { callId: 'c1', from: BILAL }),
  );
  await act(() => button('Allow recording').props.onPress());
  expect(sent(socket, 'recording:respond')[1].payload).toEqual({
    callId: 'c1',
    allow: true,
  });
});

test('a recording request for some other call is ignored, and recording resets when the call ends', async () => {
  const { socket } = await connectedOutgoingCall(false);
  await act(() =>
    socket.serverSends('recording:requested', { callId: 'old', from: BILAL }),
  );
  expect(api.recordingRequest).toBeNull();

  await act(() =>
    socket.serverSends('recording:state', { callId: 'c1', state: 'on' }),
  );
  expect(api.recording).toBe('on');
  await act(() =>
    socket.serverSends('call:ended', { callId: 'c1', reason: 'ended' }),
  );
  expect(api.recording).toBe('off');
  expect(byLabelOrNull('Recording')).toHaveLength(0);
});

test('a second call cannot start while one is open, and the log can be cleared', async () => {
  const socket = await render();
  await act(() => api.startCall(BILAL, false));
  await act(() => api.startCall({ id: '9000000000', name: 'Other' }, false));
  expect(sent(socket, 'call:start')).toHaveLength(1);

  await act(() => api.endCall());
  expect(api.history).toHaveLength(1);
  await act(() => api.clearHistory());
  expect(api.history).toEqual([]);
});

// ---- Agora: the server can put a call on Agora, and LiveKit failing moves it there ----

const AGORA_READY = {
  callId: 'c1',
  provider: 'agora',
  appId: 'app123',
  channel: 'call-c1',
  account: '9876543210',
  token: '007agora-token',
};

// A fake Agora engine: records what the app asks for and lets the test fire Agora's events
const fakeAgoraEngine = () => {
  const engine = {
    handler: null,
    initialize: jest.fn(() => 0),
    registerEventHandler: jest.fn(handler => {
      engine.handler = handler;
      return true;
    }),
    unregisterEventHandler: jest.fn(),
    enableAudio: jest.fn(),
    enableVideo: jest.fn(),
    enableLocalVideo: jest.fn(),
    startPreview: jest.fn(),
    stopPreview: jest.fn(),
    joinChannelWithUserAccount: jest.fn(() => 0),
    updateChannelMediaOptions: jest.fn(),
    muteLocalAudioStream: jest.fn(),
    setEnableSpeakerphone: jest.fn(),
    switchCamera: jest.fn(),
    leaveChannel: jest.fn(),
    release: jest.fn(),
  };
  createAgoraRtcEngine.mockImplementation(() => engine);
  return engine;
};

const ringingOutgoingCall = async video => {
  const socket = await render();
  await act(() => api.startCall(BILAL, video));
  await act(() =>
    sent(socket, 'call:start')[0].ack({ ok: true, callId: 'c1' }),
  );
  return socket;
};

test('a call the server puts on Agora joins with Agora (not LiveKit) and works like any other call', async () => {
  const engine = fakeAgoraEngine();
  const socket = await ringingOutgoingCall(false);

  await act(() => socket.serverSends('call:ready', AGORA_READY));
  expect(FakeRoom.last).toBeNull(); // LiveKit is not used
  expect(engine.initialize).toHaveBeenCalledWith(
    expect.objectContaining({ appId: 'app123' }),
  );
  expect(engine.joinChannelWithUserAccount).toHaveBeenCalledWith(
    '007agora-token',
    'call-c1',
    '9876543210',
    expect.objectContaining({
      publishMicrophoneTrack: true,
      publishCameraTrack: false,
    }),
  );
  expect(engine.setEnableSpeakerphone).toHaveBeenLastCalledWith(false); // voice calls start on the earpiece
  expect(api.call.status).toBe('connecting');

  await act(() => engine.handler.onUserJoined({}, 77, 0));
  expect(api.call.status).toBe('connected');

  await act(() => api.toggleMute());
  expect(engine.muteLocalAudioStream).toHaveBeenLastCalledWith(true);
  await act(() => api.toggleSpeaker());
  expect(engine.setEnableSpeakerphone).toHaveBeenLastCalledWith(true);

  // the other person's camera turns a voice call into a video call
  await act(() => engine.handler.onRemoteVideoStateChanged({}, 77, 2));
  expect(api.remoteVideo).toEqual({ agora: true, uid: 77 });
  expect(api.call.video).toBe(true);
  await act(() => engine.handler.onRemoteAudioStateChanged({}, 77, 0));
  expect(api.peerMedia.muted).toBe(true);

  await act(() => button('End call').props.onPress());
  expect(sent(socket, 'call:end')[0].payload).toEqual({ callId: 'c1' });
  expect(engine.leaveChannel).toHaveBeenCalled();
  expect(engine.release).toHaveBeenCalled();
  expect(AudioSession.startAudioSession).not.toHaveBeenCalled(); // LiveKit's audio was never started
  expect(AudioSession.stopAudioSession).not.toHaveBeenCalled();
  expect(api.history[0]).toMatchObject({ outcome: 'answered', video: true });
});

test('an Agora video call shows both cameras, and the camera button and flip button work', async () => {
  const engine = fakeAgoraEngine();
  const socket = await ringingOutgoingCall(true);
  await act(() => socket.serverSends('call:ready', AGORA_READY));

  expect(engine.enableVideo).toHaveBeenCalled();
  expect(engine.joinChannelWithUserAccount).toHaveBeenCalledWith(
    expect.any(String),
    'call-c1',
    '9876543210',
    expect.objectContaining({ publishCameraTrack: true }),
  );
  expect(api.localVideo).toEqual({ agora: true, uid: 0 }); // uid 0 is this phone's own camera
  expect(engine.setEnableSpeakerphone).toHaveBeenLastCalledWith(true); // video calls start on the loudspeaker

  await act(() => engine.handler.onUserJoined({}, 77, 0));
  await act(() => api.toggleCamera());
  expect(engine.updateChannelMediaOptions).toHaveBeenLastCalledWith({
    publishCameraTrack: false,
  });
  expect(api.localVideo).toBeNull();
  await act(() => api.toggleCamera());
  expect(engine.updateChannelMediaOptions).toHaveBeenLastCalledWith({
    publishCameraTrack: true,
  });
  expect(api.localVideo).toEqual({ agora: true, uid: 0 });

  await act(() => api.flipCamera());
  expect(engine.switchCamera).toHaveBeenCalled();
  expect(api.frontCamera).toBe(false);
});

test('an Agora call has no Record button even when the server can record, and a LiveKit call keeps it', async () => {
  const engine = fakeAgoraEngine();
  const socket = await ringingOutgoingCall(false);
  await act(() =>
    socket.serverSends('session', {
      activeCallId: 'c1',
      recordingAvailable: true,
    }),
  );
  await act(() => socket.serverSends('call:ready', AGORA_READY));
  await act(() => engine.handler.onUserJoined({}, 77, 0));
  expect(api.call.status).toBe('connected');
  expect(api.recordingAvailable).toBe(true);
  expect(byLabelOrNull('Record call')).toHaveLength(0);
});

test('the other person leaving an Agora call ends it, and Agora connection trouble is shown', async () => {
  const engine = fakeAgoraEngine();
  const socket = await ringingOutgoingCall(false);
  await act(() => socket.serverSends('call:ready', AGORA_READY));
  await act(() => engine.handler.onUserJoined({}, 77, 0));

  await act(() => engine.handler.onConnectionStateChanged({}, 4, 0)); // reconnecting
  expect(api.call.status).toBe('reconnecting');
  await act(() => engine.handler.onConnectionStateChanged({}, 3, 0)); // connected again
  expect(api.call.status).toBe('connected');

  await act(() => engine.handler.onUserOffline({}, 77, 0));
  expect(sent(socket, 'call:end')[0].payload).toEqual({ callId: 'c1' });
  expect(api.call.status).toBe('ended');
  expect(api.history[0].outcome).toBe('answered');
});

test('if Agora cannot join, the call ends (there is nothing further to fall back to)', async () => {
  const engine = fakeAgoraEngine();
  engine.joinChannelWithUserAccount.mockReturnValue(-2);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  const socket = await ringingOutgoingCall(false);
  await act(() => socket.serverSends('call:ready', AGORA_READY));

  expect(sent(socket, 'call:fallback')).toHaveLength(0);
  expect(sent(socket, 'call:end')[0].payload).toEqual({ callId: 'c1' });
  expect(api.call.status).toBe('ended');
  expect(engine.release).toHaveBeenCalled(); // the engine is not left running
});

test('when LiveKit refuses to connect (for example its free limit is used up) the phone asks the server to use Agora, once', async () => {
  const engine = fakeAgoraEngine();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  FakeRoom.failConnect = true;
  const socket = await ringingOutgoingCall(false);

  await act(() => socket.serverSends('call:ready', READY));
  expect(sent(socket, 'call:fallback')).toHaveLength(1);
  expect(sent(socket, 'call:fallback')[0].payload).toEqual({ callId: 'c1' });
  expect(api.call.status).toBe('connecting'); // not ended: waiting for the server's answer
  expect(sent(socket, 'call:end')).toHaveLength(0);

  // the server moves the call: LiveKit is left and Agora is joined
  const room = FakeRoom.last;
  await act(() => sent(socket, 'call:fallback')[0].ack({ ok: true }));
  await act(() => socket.serverSends('call:ready', AGORA_READY));
  expect(room.disconnect).toHaveBeenCalled();
  expect(engine.joinChannelWithUserAccount).toHaveBeenCalledTimes(1);
  await act(() => engine.handler.onUserJoined({}, 77, 0));
  expect(api.call.status).toBe('connected');

  // and the same call is never moved a second time
  await act(() => engine.handler.onConnectionStateChanged({}, 5, 0)); // failed
  expect(sent(socket, 'call:fallback')).toHaveLength(1);
  expect(api.call.status).toBe('ended');
});

test('if the server cannot move the call to Agora, the call ends as before', async () => {
  fakeAgoraEngine();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  FakeRoom.failConnect = true;
  const socket = await ringingOutgoingCall(false);
  await act(() => socket.serverSends('call:ready', READY));

  await act(() => sent(socket, 'call:fallback')[0].ack({ ok: false }));
  expect(sent(socket, 'call:end')[0].payload).toEqual({ callId: 'c1' });
  expect(api.call.status).toBe('ended');
  expect(api.call.endText).toBe('Could not connect');
});

test('losing LiveKit before the call ever connected asks for Agora instead of ending it', async () => {
  fakeAgoraEngine();
  const socket = await ringingOutgoingCall(false);
  await act(() => socket.serverSends('call:ready', READY));
  const room = FakeRoom.last;

  await act(() => room.fire('Disconnected'));
  expect(sent(socket, 'call:fallback')).toHaveLength(1);
  expect(sent(socket, 'call:end')).toHaveLength(0);
});

// ---- adding a third person to a call that is going on ----

const typeNumberOnCard = text =>
  screen.root
    .find(
      n =>
        n.props.accessibilityLabel === 'Mobile number to add' &&
        n.props.onChangeText,
    )
    .props.onChangeText(text);

test('adding a person to a connected call asks the server, with the number cleaned up', async () => {
  const { socket } = await connectedOutgoingCall(false);
  let result;
  await act(() => {
    result = api.addPersonToCall('+91 98765-43210');
  });
  expect(sent(socket, 'call:add')[0].payload).toEqual({
    callId: 'c1',
    to: '9876543210',
  });
  await act(() =>
    sent(socket, 'call:add')[0].ack({ ok: true, meetingId: 'abc-defg-hij' }),
  );
  expect(await result).toEqual({ ok: true, meetingId: 'abc-defg-hij' });
});

test('a number that is not valid, or a call that is not connected yet, is not sent to the server', async () => {
  const { socket } = await connectedOutgoingCall(false);
  let result;
  await act(async () => {
    result = await api.addPersonToCall('12345');
  });
  expect(result).toEqual({ ok: false, error: 'invalid-number' });
  expect(sent(socket, 'call:add')).toHaveLength(0);

  await act(() => button('End call').props.onPress());
  await act(() => new Promise(resolve => setTimeout(resolve, 1700))); // the "call ended" screen closes
  await act(() => api.startCall(BILAL, false)); // ringing, not connected
  await act(async () => {
    result = await api.addPersonToCall('9876543210');
  });
  expect(result).toEqual({ ok: false, error: 'not-active' });
});

test('the call screen offers "Add person" only once the call is connected', async () => {
  const socket = await render();
  await act(() => api.startCall(BILAL, false));
  expect(byLabelOrNull('Add person')).toHaveLength(0); // calling

  await act(() =>
    sent(socket, 'call:start')[0].ack({ ok: true, callId: 'c1' }),
  );
  await act(() => socket.serverSends('call:ready', READY));
  const room = FakeRoom.last;
  expect(byLabelOrNull('Add person')).toHaveLength(0); // connecting

  room.remoteParticipants.set('bilal', remotePerson());
  await act(() => room.fire('ParticipantConnected'));
  expect(byLabelOrNull('Add person').length).toBeGreaterThan(0); // connected
});

test('Add person: type or pick a number, the server is asked, and the card closes when it works', async () => {
  const { socket } = await connectedOutgoingCall(false);
  await act(() => button('Add person').props.onPress());
  expect(byLabelOrNull('Mobile number to add').length).toBeGreaterThan(0);

  await act(() => typeNumberOnCard('98765 43210'));
  await act(() => {
    button('Add this number').props.onPress(); // the answer comes later, so do not wait for it here
  });
  expect(sent(socket, 'call:add')[0].payload).toEqual({
    callId: 'c1',
    to: '9876543210',
  });
  await act(() =>
    sent(socket, 'call:add')[0].ack({ ok: true, meetingId: 'abc-defg-hij' }),
  );
  expect(byLabelOrNull('Mobile number to add')).toHaveLength(0);
});

test('Add person: a number that is not valid, or one the server refuses, is explained and the card stays open', async () => {
  const { socket } = await connectedOutgoingCall(false);
  await act(() => button('Add person').props.onPress());

  await act(() => typeNumberOnCard('12345'));
  await act(() => {
    button('Add this number').props.onPress(); // the answer comes later, so do not wait for it here
  });
  expect(sent(socket, 'call:add')).toHaveLength(0);
  expect(
    screen.root.findAll(
      n => n.props.children === 'Enter a valid 10-digit mobile number.',
    ).length,
  ).toBeGreaterThan(0);

  await act(() => typeNumberOnCard('98765 43210'));
  await act(() => {
    button('Add this number').props.onPress(); // the answer comes later, so do not wait for it here
  });
  await act(() =>
    sent(socket, 'call:add')[0].ack({ ok: false, error: 'offline' }),
  );
  expect(
    screen.root.findAll(
      n =>
        typeof n.props.children === 'string' &&
        n.props.children.startsWith(
          'They are not using Atiya Herbs right now.',
        ),
    ).length,
  ).toBeGreaterThan(0);
  expect(byLabelOrNull('Mobile number to add').length).toBeGreaterThan(0);
  expect(api.call.status).toBe('connected'); // the call goes on

  await act(() => button('Cancel adding').props.onPress());
  expect(byLabelOrNull('Mobile number to add')).toHaveLength(0);
});

test('when the call becomes a meeting, the one-to-one call closes quietly, is logged, and the meeting is signalled', async () => {
  const { socket, room } = await connectedOutgoingCall(false);
  await act(() =>
    socket.serverSends('call:upgrade', {
      callId: 'c1',
      meetingId: 'abc-defg-hij',
    }),
  );
  expect(api.call).toBeNull(); // no "call ended" screen to wait for
  expect(room.disconnect).toHaveBeenCalled();
  expect(AudioSession.stopAudioSession).toHaveBeenCalled();
  expect(api.pendingMeetingId).toBe('abc-defg-hij');
  expect(api.history[0]).toMatchObject({ peer: BILAL, outcome: 'answered' });
  expect(sent(socket, 'call:end')).toHaveLength(0); // the server already closed the call

  // the server's "call ended: upgraded" that follows changes nothing
  await act(() =>
    socket.serverSends('call:ended', { callId: 'c1', reason: 'upgraded' }),
  );
  expect(api.history).toHaveLength(1);
  expect(api.call).toBeNull();

  await act(() => api.clearPendingMeetingId());
  expect(api.pendingMeetingId).toBeNull();
});

test('a call that became a meeting is not mixed up with another call', async () => {
  const { socket } = await connectedOutgoingCall(false);
  await act(() =>
    socket.serverSends('call:upgrade', {
      callId: 'someone-elses',
      meetingId: 'abc-defg-hij',
    }),
  );
  expect(api.call.status).toBe('connected');
  expect(api.pendingMeetingId).toBeNull();
});
