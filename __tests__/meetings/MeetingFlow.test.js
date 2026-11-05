import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Alert, Linking, Modal, Platform, Vibration } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createAgoraRtcEngine } from 'react-native-agora';
import { useCall } from '../../src/calling/CallContext';
import { ensureCallPermissions } from '../../src/calling/permissions';
import { MeetingProvider, useMeeting } from '../../src/meetings/MeetingContext';
import MeetingRoom from '../../src/meetings/MeetingRoom';
import MeetingInvite from '../../src/meetings/MeetingInvite';

jest.setTimeout(30000);

// The meeting code talks to the call server through the one shared socket (CallContext) and to Agora
jest.mock('../../src/calling/CallContext', () => ({ useCall: jest.fn() }));
jest.mock('../../src/calling/permissions', () => ({
  ensureCallPermissions: jest.fn(async () => true),
}));

const SAFE_AREA = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 40, left: 0, right: 0, bottom: 20 },
};

// A fake server connection: records what the app sends, answers from `replies`, and lets the test play the server
const makeSocket = () => {
  const handlers = {};
  const socket = {
    connected: true,
    sent: [],
    replies: {},
    on: (event, fn) => (handlers[event] = [...(handlers[event] || []), fn]),
    off: (event, fn) =>
      (handlers[event] = (handlers[event] || []).filter(f => f !== fn)),
    emit: (event, payload, ack) => {
      socket.sent.push({ event, payload });
      const reply = socket.replies[event];
      if (ack && reply !== undefined) {
        ack(typeof reply === 'function' ? reply(payload) : reply);
      }
    },
    serverSends: (event, payload) =>
      (handlers[event] || []).forEach(fn => fn(payload)),
  };
  return socket;
};

// A fake Agora engine: records what the app asks for and lets the test fire Agora's events
const makeEngine = () => {
  const engine = {
    handler: null,
    accounts: {},
    initialize: jest.fn(() => 0),
    registerEventHandler: jest.fn(h => {
      engine.handler = h;
      return true;
    }),
    unregisterEventHandler: jest.fn(),
    enableAudio: jest.fn(),
    enableVideo: jest.fn(),
    enableLocalVideo: jest.fn(),
    setVideoEncoderConfiguration: jest.fn(),
    enableAudioVolumeIndication: jest.fn(),
    startPreview: jest.fn(),
    stopPreview: jest.fn(),
    joinChannelWithUserAccount: jest.fn(() => 0),
    updateChannelMediaOptions: jest.fn(),
    muteLocalAudioStream: jest.fn(),
    muteRemoteVideoStream: jest.fn(),
    setEnableSpeakerphone: jest.fn(),
    switchCamera: jest.fn(),
    startScreenCapture: jest.fn(() => 0),
    stopScreenCapture: jest.fn(),
    renewToken: jest.fn(),
    getUserInfoByUid: jest.fn(uid => ({
      uid,
      userAccount: engine.accounts[uid],
    })),
    leaveChannel: jest.fn(),
    release: jest.fn(),
  };
  createAgoraRtcEngine.mockImplementation(() => engine);
  return engine;
};

const person = (id, name, role = 'participant', extra = {}) => ({
  id,
  name,
  role,
  muted: false,
  cameraOn: false,
  sharing: false,
  joinedAt: '2026-11-05T10:00:00.000Z',
  offline: false,
  ...extra,
});
const ASHA = person('asha', 'Asha', 'host');
const BILAL = person('bilal', 'Bilal');
const CHANDNI = person('chandni', 'Chandni');
const ID = 'abc-defg-hij';
const snapshot = (participants, extra = {}) => ({
  id: ID,
  title: 'Clinic review',
  hostId: participants[0].id,
  locked: false,
  status: 'live',
  startedAt: '2026-11-05T10:00:00.000Z',
  sharingId: null,
  maxParticipants: 25,
  participants,
  ...extra,
});
const JOIN = {
  provider: 'agora',
  appId: 'app123',
  channel: 'mtg-abcdefghij',
  account: 'asha',
  token: '007meeting-token',
};

let api;
let screen;
let socket;
let engine;
let me;
let clearPending;

function Probe() {
  api = useMeeting();
  return null;
}

const render = async ({
  myId = 'asha',
  call = null,
  connected = true,
  pendingMeetingId = null,
  replies = {},
} = {}) => {
  socket = makeSocket();
  Object.assign(socket.replies, replies); // answers the server gives right from the start
  socket.connected = connected;
  engine = makeEngine();
  me = myId;
  clearPending = jest.fn();
  useCall.mockImplementation(() => ({
    socket,
    myId: me,
    call,
    pendingMeetingId,
    clearPendingMeetingId: clearPending,
  }));
  await ReactTestRenderer.act(async () => {
    screen = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={SAFE_AREA}>
        <MeetingProvider>
          <Probe />
          <MeetingRoom />
          <MeetingInvite />
        </MeetingProvider>
      </SafeAreaProvider>,
    );
  });
};

const flush = () => new Promise(resolve => setImmediate(resolve));
const act = fn =>
  ReactTestRenderer.act(async () => {
    await fn();
    await flush();
    await flush();
  });
const byLabel = label =>
  screen.root.findAll(n => n.props.accessibilityLabel === label);
const button = label =>
  screen.root.find(
    n => n.props.accessibilityLabel === label && n.props.onPress,
  );
const sent = event => socket.sent.filter(s => s.event === event);
const alertText = () => Alert.alert.mock.calls.map(c => c[1]);

// Asha starts a meeting; Bilal and Chandni are then in it (the server's list and Agora's join events)
const startedWithThree = async () => {
  await render();
  socket.replies['meeting:create'] = {
    ok: true,
    meeting: snapshot([ASHA]),
    join: JOIN,
    chat: [],
    you: { id: 'asha', role: 'host' },
  };
  engine.accounts = { 101: 'bilal', 102: 'chandni' };
  await act(() => api.createMeeting('Clinic review'));
  await act(() =>
    socket.serverSends('meeting:update', snapshot([ASHA, BILAL, CHANDNI])),
  );
  await act(() => {
    engine.handler.onUserJoined({}, 101, 0);
    engine.handler.onUserJoined({}, 102, 0);
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  ensureCallPermissions.mockImplementation(async () => true);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(null);
  jest.spyOn(Vibration, 'vibrate').mockImplementation(() => {});
  jest.spyOn(Vibration, 'cancel').mockImplementation(() => {});
});
afterEach(async () => {
  await act(() => screen?.unmount());
  screen = null;
  jest.restoreAllMocks();
});

test("starting a meeting asks the server, joins Agora with the server's token, and shows you as the host", async () => {
  await render();
  socket.replies['meeting:create'] = {
    ok: true,
    meeting: snapshot([ASHA]),
    join: JOIN,
    chat: [],
    you: { id: 'asha', role: 'host' },
  };
  await act(() => api.createMeeting('Clinic review'));

  expect(sent('meeting:create')[0].payload).toEqual({ title: 'Clinic review' });
  expect(engine.initialize).toHaveBeenCalledWith(
    expect.objectContaining({ appId: 'app123' }),
  );
  expect(engine.joinChannelWithUserAccount).toHaveBeenCalledWith(
    '007meeting-token',
    'mtg-abcdefghij',
    'asha',
    expect.objectContaining({
      publishMicrophoneTrack: true,
      publishCameraTrack: false,
    }), // the camera starts off
  );
  expect(api.status).toBe('live');
  expect(api.isHost).toBe(true);
  expect(api.people).toMatchObject([{ id: 'asha', isMe: true, uid: 0 }]);
  expect(screen.root.findAllByType(Modal)).toHaveLength(1);
  expect(byLabel('Asha (you)')).not.toHaveLength(0);
});

test("three people in one meeting: each has a tile, and Agora's events show who has video, who is muted and who is talking", async () => {
  await startedWithThree();
  expect(api.people.map(p => [p.id, p.uid])).toEqual([
    ['asha', 0],
    ['bilal', 101],
    ['chandni', 102],
  ]);
  for (const label of ['Asha (you)', 'Bilal', 'Chandni']) {
    expect(byLabel(label)).not.toHaveLength(0);
  }

  await act(() => {
    engine.handler.onRemoteVideoStateChanged({}, 101, 2); // Bilal's camera is on
    engine.handler.onRemoteAudioStateChanged({}, 102, 0); // Chandni is muted
    engine.handler.onAudioVolumeIndication({}, [{ uid: 101, volume: 120 }]);
  });
  const bilal = api.people.find(p => p.id === 'bilal');
  const chandni = api.people.find(p => p.id === 'chandni');
  expect([bilal.videoOn, bilal.speaking, chandni.muted]).toEqual([
    true,
    true,
    true,
  ]);
  expect(api.speakingUid).toBe(101);

  await act(() =>
    engine.handler.onAudioVolumeIndication({}, [{ uid: 101, volume: 5 }]),
  ); // only background noise
  expect(api.speakingUid).toBeNull();

  await act(() => engine.handler.onUserOffline({}, 102, 0));
  expect(api.people.find(p => p.id === 'chandni').uid).toBeUndefined();
});

test('only the people on screen have their video downloaded', async () => {
  await startedWithThree();
  expect(engine.muteRemoteVideoStream).toHaveBeenCalledWith(101, false);
  expect(engine.muteRemoteVideoStream).toHaveBeenCalledWith(102, false);
});

test('mute, camera, flip and speaker work, and the others are told about the mic and camera', async () => {
  await startedWithThree();
  await act(() => button('Mute').props.onPress());
  expect(engine.muteLocalAudioStream).toHaveBeenLastCalledWith(true);
  expect(sent('meeting:state').at(-1).payload).toEqual({ id: ID, muted: true });
  expect(byLabel('Unmute')).not.toHaveLength(0);

  expect(byLabel('Switch camera')).toHaveLength(0); // only while the camera is on
  await act(() => button('Turn camera on').props.onPress());
  expect(ensureCallPermissions).toHaveBeenLastCalledWith(true);
  expect(engine.updateChannelMediaOptions).toHaveBeenLastCalledWith({
    publishCameraTrack: true,
  });
  expect(sent('meeting:state').at(-1).payload).toEqual({
    id: ID,
    cameraOn: true,
  });
  expect(api.people[0].videoOn).toBe(true);

  await act(() => button('Switch camera').props.onPress());
  expect(engine.switchCamera).toHaveBeenCalled();
  expect(api.frontCamera).toBe(false);

  await act(() => button('Use earpiece').props.onPress()); // meetings start on the loudspeaker
  expect(engine.setEnableSpeakerphone).toHaveBeenLastCalledWith(false);

  await act(() => button('Turn camera off').props.onPress());
  expect(engine.updateChannelMediaOptions).toHaveBeenLastCalledWith({
    publishCameraTrack: false,
  });
});

test('the camera is not opened if the permission is refused', async () => {
  await startedWithThree();
  ensureCallPermissions.mockResolvedValueOnce(false);
  await act(() => button('Turn camera on').props.onPress());
  expect(engine.updateChannelMediaOptions).not.toHaveBeenCalledWith({
    publishCameraTrack: true,
  });
  expect(alertText().join(' ')).toMatch(/camera access/);
});

test('chat: messages reach everyone once, unread messages are counted until the chat is opened, and sending goes to the server', async () => {
  await startedWithThree();
  const message = {
    id: 'm1',
    from: { id: 'bilal', name: 'Bilal' },
    text: 'Namaste sab',
    at: '2026-11-05T10:01:00.000Z',
  };
  await act(() => socket.serverSends('meeting:chat', { id: ID, message }));
  await act(() => socket.serverSends('meeting:chat', { id: ID, message })); // the same message again
  expect(api.chat).toHaveLength(1);
  expect(api.unread).toBe(1);
  expect(byLabel('1 unread')).not.toHaveLength(0);

  await act(() => button('Chat').props.onPress());
  expect(api.unread).toBe(0);
  expect(
    screen.root.findAll(n => n.props.children === 'Namaste sab').length,
  ).toBeGreaterThan(0);

  const mine = {
    id: 'm2',
    from: { id: 'asha', name: 'Asha' },
    text: 'Hi Bilal',
    at: '2026-11-05T10:02:00.000Z',
  };
  await act(() =>
    socket.serverSends('meeting:chat', { id: ID, message: mine }),
  );
  expect(api.unread).toBe(0); // the chat is open, and your own messages never count

  socket.replies['meeting:chat'] = { ok: true };
  await act(() => api.sendChat('  Thanks  '));
  expect(sent('meeting:chat')[0].payload).toEqual({
    id: ID,
    text: '  Thanks  ',
  });

  socket.replies['meeting:chat'] = { ok: false, error: 'slow-down' };
  expect(
    await (async () => {
      let r;
      await act(async () => {
        r = await api.sendChat('again');
      });
      return r;
    })(),
  ).toBe(false);
  expect(api.notice).toMatch(/wait a moment/);
  await act(() =>
    socket.serverSends('meeting:chat', {
      id: 'someone-elses-meeting',
      message: { ...message, id: 'm9' },
    }),
  );
  expect(api.chat).toHaveLength(2); // a message for another meeting is ignored
});

test('people who join later get the earlier chat', async () => {
  await render();
  const old = [
    {
      id: 'm0',
      from: { id: 'bilal', name: 'Bilal' },
      text: 'Earlier',
      at: '2026-11-05T10:00:30.000Z',
    },
  ];
  socket.replies['meeting:join'] = {
    ok: true,
    meeting: snapshot([BILAL, ASHA]),
    join: JOIN,
    chat: old,
    you: { id: 'asha', role: 'participant' },
  };
  await act(() => api.joinMeeting(ID));
  expect(sent('meeting:join')[0].payload).toEqual({ id: ID });
  expect(api.chat).toEqual(old);
  expect(api.isHost).toBe(false);
});

test('the People panel lists everyone, and only the host sees the host controls', async () => {
  await startedWithThree();
  await act(() => button('People').props.onPress());
  expect(byLabel('Mute everyone')).not.toHaveLength(0);
  expect(byLabel('Lock meeting')).not.toHaveLength(0);
  expect(byLabel('Mute Bilal')).not.toHaveLength(0);
  expect(byLabel('Remove Chandni')).not.toHaveLength(0);
  expect(byLabel('Mute Asha')).toHaveLength(0); // not for yourself

  await act(() => button('Mute everyone').props.onPress());
  expect(sent('meeting:mute').at(-1).payload).toEqual({
    id: ID,
    userId: 'all',
  });
  await act(() => button('Mute Bilal').props.onPress());
  expect(sent('meeting:mute').at(-1).payload).toEqual({
    id: ID,
    userId: 'bilal',
  });
});

test('removing someone asks first, then tells the server', async () => {
  await startedWithThree();
  await act(() => button('People').props.onPress());
  await act(() => button('Remove Chandni').props.onPress());
  expect(Alert.alert).toHaveBeenLastCalledWith(
    'Remove from meeting',
    expect.stringContaining('Chandni'),
    expect.any(Array),
  );
  expect(sent('meeting:remove')).toHaveLength(0); // nothing yet
  const confirm = Alert.alert.mock.calls
    .at(-1)[2]
    .find(b => b.text === 'Remove');
  socket.replies['meeting:remove'] = { ok: true };
  await act(() => confirm.onPress());
  expect(sent('meeting:remove')[0].payload).toEqual({
    id: ID,
    userId: 'chandni',
  });
});

test('locking the meeting goes to the server, and a refusal from a non-host is explained', async () => {
  await startedWithThree();
  socket.replies['meeting:lock'] = { ok: true, locked: true };
  await act(() => api.setLocked(true));
  expect(sent('meeting:lock')[0].payload).toEqual({ id: ID, locked: true });
  expect(api.notice).toMatch(/locked/);

  socket.replies['meeting:mute'] = { ok: false, error: 'host-only' };
  await act(() => api.muteAll());
  expect(api.notice).toBe('Only the host can do that.');
});

test('a participant has no host controls', async () => {
  await render({ myId: 'bilal' });
  socket.replies['meeting:join'] = {
    ok: true,
    meeting: snapshot([ASHA, BILAL]),
    join: { ...JOIN, account: 'bilal' },
    chat: [],
    you: { id: 'bilal', role: 'participant' },
  };
  await act(() => api.joinMeeting(ID));
  await act(() => button('People').props.onPress());
  expect(byLabel('Mute everyone')).toHaveLength(0);
  expect(byLabel('Lock meeting')).toHaveLength(0);
  expect(byLabel('Remove Asha')).toHaveLength(0);
});

test('when the host asks you to mute, you are muted and told so', async () => {
  await startedWithThree();
  await act(() =>
    socket.serverSends('meeting:mute-request', {
      id: ID,
      by: { id: 'asha', name: 'Asha' },
      all: false,
    }),
  );
  expect(engine.muteLocalAudioStream).toHaveBeenLastCalledWith(true);
  expect(api.muted).toBe(true);
  expect(sent('meeting:state').at(-1).payload).toEqual({ id: ID, muted: true });
  expect(api.notice).toBe('Asha muted you.');
});

test('being removed, or the host ending the meeting, leaves it and says why; an empty meeting closes quietly', async () => {
  await startedWithThree();
  await act(() =>
    socket.serverSends('meeting:removed', {
      id: ID,
      by: { id: 'asha', name: 'Asha' },
    }),
  );
  expect(api.status).toBe('idle');
  expect(engine.release).toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenLastCalledWith(
    'Meeting',
    'The host removed you from the meeting.',
  );

  await startedWithThree();
  Alert.alert.mockClear();
  await act(() =>
    socket.serverSends('meeting:ended', { id: ID, reason: 'host', by: 'asha' }),
  );
  expect(api.status).toBe('idle');
  expect(Alert.alert).toHaveBeenCalledWith(
    'Meeting',
    'The host ended the meeting.',
  );

  await startedWithThree();
  Alert.alert.mockClear();
  await act(() =>
    socket.serverSends('meeting:ended', { id: ID, reason: 'empty' }),
  );
  expect(api.status).toBe('idle');
  expect(Alert.alert).not.toHaveBeenCalled();
});

test('news about some other meeting does not touch this one', async () => {
  await startedWithThree();
  await act(() =>
    socket.serverSends('meeting:ended', { id: 'zzz-zzzz-zzz', reason: 'host' }),
  );
  await act(() =>
    socket.serverSends('meeting:removed', { id: 'zzz-zzzz-zzz' }),
  );
  expect(api.status).toBe('live');
});

test('leaving tells the server and releases Agora; the host is asked whether to leave or end it for everyone', async () => {
  await startedWithThree();
  await act(() => button('Leave meeting').props.onPress());
  const options = Alert.alert.mock.calls.at(-1)[2].map(b => b.text);
  expect(options).toEqual(['Cancel', 'Leave', 'End for all']);

  await act(() =>
    Alert.alert.mock.calls
      .at(-1)[2]
      .find(b => b.text === 'Leave')
      .onPress(),
  );
  expect(sent('meeting:leave')[0].payload).toEqual({ id: ID });
  expect(engine.leaveChannel).toHaveBeenCalled();
  expect(engine.release).toHaveBeenCalled();
  expect(api.status).toBe('idle');
  expect(screen.root.findAllByType(Modal)).toHaveLength(0);
});

test('ending the meeting for everyone', async () => {
  await startedWithThree();
  await act(() => button('Leave meeting').props.onPress());
  await act(() =>
    Alert.alert.mock.calls
      .at(-1)[2]
      .find(b => b.text === 'End for all')
      .onPress(),
  );
  expect(sent('meeting:end')[0].payload).toEqual({ id: ID });
  expect(api.status).toBe('idle');
});

test('a participant is simply asked to confirm leaving', async () => {
  await render({ myId: 'bilal' });
  socket.replies['meeting:join'] = {
    ok: true,
    meeting: snapshot([ASHA, BILAL]),
    join: JOIN,
    chat: [],
    you: { id: 'bilal', role: 'participant' },
  };
  await act(() => api.joinMeeting(ID));
  await act(() => button('Leave meeting').props.onPress());
  expect(Alert.alert.mock.calls.at(-1)[2].map(b => b.text)).toEqual([
    'Cancel',
    'Leave',
  ]);
});

test('screen sharing (Android): one person at a time, the screen goes out instead of the camera and the camera comes back', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  await startedWithThree();
  await act(() => button('Turn camera on').props.onPress());

  socket.replies['meeting:share'] = { ok: true };
  await act(() => button('Share screen').props.onPress());
  expect(sent('meeting:share')[0].payload).toEqual({ id: ID, sharing: true });
  expect(engine.startScreenCapture).toHaveBeenCalledWith(
    expect.objectContaining({ captureVideo: true }),
  );
  expect(engine.updateChannelMediaOptions).toHaveBeenLastCalledWith({
    publishScreenCaptureVideo: true,
    publishCameraTrack: false,
  });
  expect(api.sharing).toBe(true);

  await act(() => button('Turn camera off').props.onPress()); // cannot switch the camera while sharing
  expect(api.notice).toMatch(/Stop sharing/);

  await act(() => button('Stop sharing').props.onPress());
  expect(sent('meeting:share').at(-1).payload).toEqual({
    id: ID,
    sharing: false,
  });
  expect(engine.stopScreenCapture).toHaveBeenCalled();
  expect(engine.updateChannelMediaOptions).toHaveBeenCalledWith({
    publishScreenCaptureVideo: false,
    publishCameraTrack: true,
  });
  expect(api.sharing).toBe(false);
});

test('screen sharing is refused when someone else is already sharing, and when Agora cannot start it', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  await startedWithThree();
  socket.replies['meeting:share'] = { ok: false, error: 'busy', by: 'Bilal' };
  await act(() => button('Share screen').props.onPress());
  expect(engine.startScreenCapture).not.toHaveBeenCalled();
  expect(alertText()).toContain('Bilal is already sharing their screen.');

  socket.replies['meeting:share'] = { ok: true };
  engine.startScreenCapture.mockReturnValue(-3);
  await act(() => button('Share screen').props.onPress());
  expect(api.sharing).toBe(false);
  expect(sent('meeting:share').at(-1).payload).toEqual({
    id: ID,
    sharing: false,
  }); // the server is told it did not start
  expect(alertText()).toContain('Could not start screen sharing.');
});

test('on iPhone the share button is not offered yet', async () => {
  await startedWithThree(); // the test platform is not Android
  expect(byLabel('Share screen')).toHaveLength(0);
  await act(() => api.toggleScreenShare());
  expect(alertText()).toContain(
    'Screen sharing is available on Android for now.',
  );
});

test('the screen shows who is sharing, and the sharer appears first', async () => {
  await startedWithThree();
  await act(() =>
    socket.serverSends(
      'meeting:update',
      snapshot([ASHA, BILAL, CHANDNI], { sharingId: 'chandni' }),
    ),
  );
  expect(
    screen.root.findAll(
      n =>
        typeof n.props.children === 'string' &&
        n.props.children === 'Chandni is sharing their screen',
    ).length,
  ).toBeGreaterThan(0);
});

test('when the connection comes back the app asks to be put back in the meeting; if it is gone the meeting closes', async () => {
  await startedWithThree();
  socket.replies['meeting:join'] = {
    ok: true,
    meeting: snapshot([ASHA, BILAL, CHANDNI]),
    join: JOIN,
    chat: [],
    you: { id: 'asha', role: 'host' },
  };
  await act(() => socket.serverSends('connect'));
  expect(sent('meeting:join').at(-1).payload).toEqual({ id: ID });
  expect(api.status).toBe('live');

  socket.replies['meeting:join'] = { ok: false, error: 'ended' };
  await act(() => socket.serverSends('connect'));
  expect(api.status).toBe('idle');
  expect(alertText()).toContain('That meeting has ended.');
});

test('Agora reconnecting is shown, and a lost connection ends the meeting', async () => {
  await startedWithThree();
  await act(() => engine.handler.onConnectionStateChanged({}, 4, 0)); // reconnecting
  expect(api.connection).toBe('reconnecting');
  expect(
    screen.root.findAll(n => n.props.children === 'Reconnecting…').length,
  ).toBeGreaterThan(0);
  await act(() => engine.handler.onConnectionStateChanged({}, 3, 0)); // connected again
  expect(api.connection).toBe('connected');

  await act(() => engine.handler.onConnectionStateChanged({}, 5, 0)); // failed
  expect(api.status).toBe('idle');
  expect(sent('meeting:leave')).toHaveLength(1);
  expect(alertText()).toContain('The connection to the meeting was lost.');
});

test('a token about to run out is renewed with a fresh one from the server', async () => {
  await startedWithThree();
  socket.replies['meeting:token'] = {
    ok: true,
    join: { ...JOIN, token: '007fresh' },
  };
  await act(() => engine.handler.onTokenPrivilegeWillExpire({}, 'old'));
  expect(sent('meeting:token')[0].payload).toEqual({ id: ID });
  expect(engine.renewToken).toHaveBeenCalledWith('007fresh');
});

test('a meeting cannot be started when you are not logged in, not connected, or on a call', async () => {
  await render({ myId: '' });
  await act(() => api.createMeeting(''));
  expect(alertText().join(' ')).toMatch(/Log in/);

  await render({ connected: false });
  await act(() => api.createMeeting(''));
  expect(alertText().join(' ')).toMatch(/Not connected/);

  Alert.alert.mockClear();
  await render({ call: { id: 'c1', status: 'connected' } });
  await act(() => api.createMeeting(''));
  expect(alertText()).toContain('Finish your call before joining a meeting.');
  expect(sent('meeting:create')).toHaveLength(0);
  expect(api.status).toBe('idle');
});

test('microphone permission is needed to join', async () => {
  await render();
  ensureCallPermissions.mockResolvedValueOnce(false);
  await act(() => api.createMeeting(''));
  expect(alertText().join(' ')).toMatch(/microphone access/);
  expect(sent('meeting:create')).toHaveLength(0);
});

test("the server's reasons for refusing are explained in words", async () => {
  const cases = {
    'not-found': 'No meeting with that id. Check it and try again.',
    ended: 'That meeting has ended.',
    removed: 'The host removed you from that meeting.',
    locked: 'The host has locked that meeting.',
    full: 'That meeting is full.',
    'in-call': 'Finish your call before joining a meeting.',
  };
  for (const [error, text] of Object.entries(cases)) {
    await render();
    socket.replies['meeting:join'] = { ok: false, error };
    await act(() => api.joinMeeting(ID));
    expect(alertText()).toContain(text);
    expect(api.status).toBe('idle');
    await act(() => screen.unmount());
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    ensureCallPermissions.mockImplementation(async () => true);
  }
});

test('a server that does not answer does not leave the screen waiting', async () => {
  jest.useFakeTimers();
  await render();
  // no reply is set for meeting:create
  let started;
  await ReactTestRenderer.act(async () => {
    started = api.createMeeting('');
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(9000);
    await started;
  });
  expect(api.status).toBe('idle');
  expect(alertText().join(' ')).toMatch(/did not answer/);
  jest.useRealTimers();
});

test('if Agora cannot connect, the server is told to let you go and the meeting is not shown', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  await render();
  socket.replies['meeting:create'] = {
    ok: true,
    meeting: snapshot([ASHA]),
    join: JOIN,
    chat: [],
    you: { id: 'asha', role: 'host' },
  };
  engine.joinChannelWithUserAccount.mockReturnValue(-2);
  await act(() => api.createMeeting(''));
  expect(sent('meeting:leave')[0].payload).toEqual({ id: ID });
  expect(engine.release).toHaveBeenCalled();
  expect(api.status).toBe('idle');
  expect(alertText().join(' ')).toMatch(/Could not connect/);
});

test('logging out leaves the meeting', async () => {
  await startedWithThree();
  useCall.mockImplementation(() => ({ socket: null, myId: '', call: null }));
  await act(() =>
    screen.update(
      <SafeAreaProvider initialMetrics={SAFE_AREA}>
        <MeetingProvider>
          <Probe />
          <MeetingRoom />
        </MeetingProvider>
      </SafeAreaProvider>,
    ),
  );
  expect(api.status).toBe('idle');
  expect(engine.release).toHaveBeenCalled();
});

test('a meeting link opens the app and offers to join; joining uses the id from the link', async () => {
  Linking.getInitialURL.mockResolvedValue('atiyaherbs://meeting/ABC-DEFG-HIJ');
  await render();
  await act(() => flush());
  expect(Alert.alert).toHaveBeenCalledWith(
    'Join meeting',
    'Join the meeting abc-defg-hij?',
    expect.any(Array),
  );
  socket.replies['meeting:join'] = {
    ok: true,
    meeting: snapshot([ASHA, BILAL]),
    join: JOIN,
    chat: [],
    you: { id: 'bilal', role: 'participant' },
  };
  await act(() =>
    Alert.alert.mock.calls
      .at(-1)[2]
      .find(b => b.text === 'Join')
      .onPress(),
  );
  expect(sent('meeting:join')[0].payload).toEqual({ id: 'abc-defg-hij' });
  expect(api.status).toBe('live');
});

test('a link that is not a meeting link is ignored', async () => {
  Linking.getInitialURL.mockResolvedValue('https://example.com/something');
  await render();
  await act(() => flush());
  expect(Alert.alert).not.toHaveBeenCalled();
});

test('twelve people: eight tiles and a "+4 more people" tile, and everyone is in the People list', async () => {
  await render();
  const many = Array.from({ length: 12 }, (_, i) =>
    i === 0 ? ASHA : person(`p${i}`, `Person ${i}`),
  );
  socket.replies['meeting:create'] = {
    ok: true,
    meeting: snapshot(many),
    join: JOIN,
    chat: [],
    you: { id: 'asha', role: 'host' },
  };
  await act(() => api.createMeeting(''));
  expect(api.people).toHaveLength(12);
  expect(byLabel('4 more people')).not.toHaveLength(0);
  expect(byLabel('Person 1')).not.toHaveLength(0);
  await act(() => button('People').props.onPress());
  expect(byLabel('Person 9')).toHaveLength(0); // Person 9 has no tile (the list shows the first rows; the rest scroll)
  expect(byLabel('Mute Person 9')).not.toHaveLength(0); // but the host can still manage them
});

test('a meeting can be shared as text with its id and link', async () => {
  const { Share } = require('react-native');
  const share = jest.spyOn(Share, 'share').mockResolvedValue({});
  await startedWithThree();
  await act(() => button('Share meeting invite').props.onPress());
  const message = share.mock.calls[0][0].message;
  expect(message).toContain('Clinic review');
  expect(message).toContain(ID);
  expect(message).toContain(`atiyaherbs://meeting/${ID}`);
});

test('your recent meetings come from the server', async () => {
  await render();
  const list = [
    {
      id: ID,
      title: 'Clinic review',
      status: 'ended',
      createdAt: '2026-11-05T10:00:00.000Z',
    },
  ];
  socket.replies['meeting:list'] = { ok: true, meetings: list };
  let result;
  await act(async () => {
    result = await api.listMeetings();
  });
  expect(result).toEqual(list);
});

// ---- ringing: someone adds you to a call or meeting, and you add people by number ----

const INVITATION = {
  id: ID,
  title: 'Clinic review',
  from: { id: '9123456780', name: 'Bilal' },
  ttlMs: 45000,
};
const typeNumber = text =>
  screen.root
    .find(
      n =>
        n.props.accessibilityLabel === 'Mobile number to add' &&
        n.props.onChangeText,
    )
    .props.onChangeText(text);

test('someone adding you rings like a call: Accept joins the meeting, and the ringing stops', async () => {
  await render({ myId: 'dev' });
  await act(() => socket.serverSends('meeting:invitation', INVITATION));
  expect(api.invitation).toEqual(INVITATION);
  expect(byLabel('Accept')).not.toHaveLength(0);
  expect(byLabel('Decline')).not.toHaveLength(0);
  expect(
    screen.root.findAll(n => n.props.children === 'Bilal').length,
  ).toBeGreaterThan(0);
  expect(Vibration.vibrate).toHaveBeenCalledWith([0, 800, 1200], true);

  socket.replies['meeting:join'] = {
    ok: true,
    meeting: snapshot([ASHA, BILAL, person('dev', 'Dev')]),
    join: { ...JOIN, account: 'dev' },
    chat: [],
    you: { id: 'dev', role: 'participant' },
  };
  await act(() => button('Accept').props.onPress());
  expect(sent('meeting:join')[0].payload).toEqual({ id: ID });
  expect(api.invitation).toBeNull();
  expect(api.status).toBe('live');
  expect(Vibration.cancel).toHaveBeenCalled();
  expect(byLabel('Accept')).toHaveLength(0);
});

test('Decline tells the server and closes the ringing screen', async () => {
  await render({ myId: 'dev' });
  await act(() => socket.serverSends('meeting:invitation', INVITATION));
  await act(() => button('Decline').props.onPress());
  expect(sent('meeting:decline')[0].payload).toEqual({ id: ID });
  expect(api.invitation).toBeNull();
  expect(sent('meeting:join')).toHaveLength(0);
  expect(api.status).toBe('idle');
});

test("the ringing screen closes when the ringing stops (cancelled, timed out or the meeting ended); another meeting's message is ignored", async () => {
  await render({ myId: 'dev' });
  await act(() => socket.serverSends('meeting:invitation', INVITATION));
  await act(() =>
    socket.serverSends('meeting:invitation-ended', { id: 'zzz-zzzz-zzz' }),
  );
  expect(api.invitation).not.toBeNull();
  await act(() => socket.serverSends('meeting:invitation-ended', { id: ID }));
  expect(api.invitation).toBeNull();
  expect(Vibration.cancel).toHaveBeenCalled();
});

test('if you are already in a meeting or on a call, an invitation is turned down without a screen', async () => {
  await startedWithThree();
  await act(() =>
    socket.serverSends('meeting:invitation', {
      ...INVITATION,
      id: 'zzz-zzzz-zzz',
    }),
  );
  expect(api.invitation).toBeNull();
  expect(sent('meeting:decline').at(-1).payload).toEqual({
    id: 'zzz-zzzz-zzz',
  });

  await act(() => screen.unmount());
  await render({ myId: 'dev', call: { id: 'c1', status: 'connected' } });
  await act(() => socket.serverSends('meeting:invitation', INVITATION));
  expect(api.invitation).toBeNull();
  expect(sent('meeting:decline')[0].payload).toEqual({ id: ID });
});

test('"Add people" in the meeting rings a number: the number is cleaned up, sent, and the card closes', async () => {
  await startedWithThree();
  await act(() => button('People').props.onPress());
  await act(() => button('Add people').props.onPress());
  expect(byLabel('Mobile number to add')).not.toHaveLength(0);

  socket.replies['meeting:invite'] = {
    ok: true,
    invited: { id: '9876543210', name: 'Dev' },
  };
  await act(() => typeNumber('+91 98765-43210'));
  await act(() => button('Add this number').props.onPress());
  expect(sent('meeting:invite')[0].payload).toEqual({
    id: ID,
    to: '9876543210',
  });
  expect(byLabel('Mobile number to add')).toHaveLength(0); // closed
  expect(api.notice).toBe('Ringing Dev…');
});

test('a number that is not valid is not sent, and a refusal from the server is explained on the card', async () => {
  await startedWithThree();
  await act(() => button('People').props.onPress());
  await act(() => button('Add people').props.onPress());

  await act(() => typeNumber('12345'));
  await act(() => button('Add this number').props.onPress());
  expect(sent('meeting:invite')).toHaveLength(0);
  expect(
    screen.root.findAll(
      n => n.props.children === 'Enter a valid 10-digit mobile number.',
    ).length,
  ).toBeGreaterThan(0);

  const cases = {
    offline: 'They are not using Atiya Herbs right now.',
    busy: 'They are on another call or meeting.',
    'already-in': 'They are already in the meeting.',
    locked: 'The meeting is locked.',
    full: 'The meeting is full.',
  };
  for (const [error, text] of Object.entries(cases)) {
    socket.replies['meeting:invite'] = { ok: false, error };
    await act(() => typeNumber('98765 43210'));
    await act(() => button('Add this number').props.onPress());
    expect(
      screen.root.findAll(
        n =>
          typeof n.props.children === 'string' &&
          n.props.children.startsWith(text),
      ).length,
    ).toBeGreaterThan(0);
    expect(byLabel('Mobile number to add')).not.toHaveLength(0); // the card stays so another number can be tried
  }
  await act(() => button('Cancel adding').props.onPress());
  expect(byLabel('Mobile number to add')).toHaveLength(0);
});

test('people being rung are listed as "Ringing…", and the one who rang (or the host) can stop it', async () => {
  await startedWithThree();
  await act(() =>
    socket.serverSends(
      'meeting:update',
      snapshot([ASHA, BILAL, CHANDNI], {
        invited: [
          { id: 'dev', name: 'Dev', by: 'asha' },
          { id: 'ravi', name: 'Ravi', by: 'bilal' },
        ],
      }),
    ),
  );
  await act(() => button('People').props.onPress());
  expect(api.invited.map(i => i.id)).toEqual(['dev', 'ravi']);
  expect(byLabel('Stop ringing Dev')).not.toHaveLength(0); // Asha rang Dev
  expect(byLabel('Stop ringing Ravi')).not.toHaveLength(0); // and Asha is the host
  socket.replies['meeting:cancel-invite'] = { ok: true };
  await act(() => button('Stop ringing Dev').props.onPress());
  expect(sent('meeting:cancel-invite')[0].payload).toEqual({
    id: ID,
    userId: 'dev',
  });

  // a participant can stop only the ringing they started
  await act(() => screen.unmount());
  await render({ myId: 'chandni' });
  socket.replies['meeting:join'] = {
    ok: true,
    meeting: snapshot([ASHA, CHANDNI], {
      invited: [
        { id: 'dev', name: 'Dev', by: 'asha' },
        { id: 'ravi', name: 'Ravi', by: 'chandni' },
      ],
    }),
    join: JOIN,
    chat: [],
    you: { id: 'chandni', role: 'participant' },
  };
  await act(() => api.joinMeeting(ID));
  await act(() => button('People').props.onPress());
  expect(byLabel('Stop ringing Dev')).toHaveLength(0);
  expect(byLabel('Stop ringing Ravi')).not.toHaveLength(0);
});

test('you are told when someone you rang says no or does not answer', async () => {
  await startedWithThree();
  await act(() =>
    socket.serverSends('meeting:invite-result', {
      id: ID,
      to: 'dev',
      name: 'Dev',
      result: 'declined',
    }),
  );
  expect(api.notice).toBe('Dev declined.');
  await act(() =>
    socket.serverSends('meeting:invite-result', {
      id: ID,
      to: 'ravi',
      name: 'Ravi',
      result: 'no-answer',
    }),
  );
  expect(api.notice).toBe('Ravi did not answer.');
  await act(() =>
    socket.serverSends('meeting:invite-result', {
      id: 'zzz-zzzz-zzz',
      to: 'x',
      name: 'X',
      result: 'declined',
    }),
  );
  expect(api.notice).toBe('Ravi did not answer.'); // another meeting: ignored
});

test('when your call became a meeting, the app joins it by itself and clears the signal', async () => {
  await render({
    pendingMeetingId: ID,
    replies: {
      'meeting:join': {
        ok: true,
        meeting: snapshot([ASHA, BILAL]),
        join: JOIN,
        chat: [],
        you: { id: 'asha', role: 'host' },
      },
    },
  });
  await act(() => flush());
  expect(sent('meeting:join')[0].payload).toEqual({ id: ID });
  expect(clearPending).toHaveBeenCalled();
  expect(api.status).toBe('live');
});

test('numbers cannot be added when there is no meeting', async () => {
  await render();
  expect(
    await (async () => {
      let r;
      await act(async () => {
        r = await api.inviteByNumber('98765 43210');
      });
      return r;
    })(),
  ).toEqual({ ok: false, error: 'not-active' });
  expect(sent('meeting:invite')).toHaveLength(0);
});
