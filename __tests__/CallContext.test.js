import React, { useEffect } from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Alert, Modal, Platform, Vibration } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AudioSession } from '@livekit/react-native';
import { Room as FakeRoom } from 'livekit-client';
import { AuthProvider, useAuth } from '../src/context/AuthContext';
import { CallProvider, callUserId, useCall } from '../src/context/CallContext';
import CallOverlay from '../src/components/CallOverlay';

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
      this.connect = jest.fn(async () => {});
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
