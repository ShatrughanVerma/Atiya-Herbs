import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Alert, Modal, Vibration } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createAgoraRtcEngine } from 'react-native-agora';
import { useCall } from '../../src/calling/CallContext';
import { ensureCallPermissions } from '../../src/calling/permissions';
import {
  ConferenceProvider,
  useConference,
} from '../../src/conference/ConferenceContext';
import ConferenceRoom from '../../src/conference/ConferenceRoom';
import ConferenceInvite from '../../src/conference/ConferenceInvite';

jest.setTimeout(30000);

// The conference code talks to the call server through the one shared socket (CallContext) and to Agora
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

const person = (id, name, extra = {}) => ({
  id,
  name,
  muted: false,
  cameraOn: false,
  offline: false,
  joinedAt: '2026-11-05T10:00:00.000Z',
  ...extra,
});
const ASHA = person('asha', 'Asha');
const BILAL = person('bilal', 'Bilal');
const CHANDNI = person('chandni', 'Chandni');
const ID = 'abcdefghij';
const snapshot = (participants, extra = {}) => ({
  id: ID,
  video: false,
  startedAt: '2026-11-05T10:00:00.000Z',
  maxParticipants: 100,
  participants,
  invited: [],
  ...extra,
});
const JOIN = {
  provider: 'agora',
  appId: 'app123',
  channel: 'conf-abcdefghij',
  account: 'asha',
  token: '007conf-token',
};
const joined = (participants, extra) => ({
  ok: true,
  conference: snapshot(participants, extra),
  join: JOIN,
  you: { id: 'asha' },
});

let api;
let screen;
let socket;
let engine;
let clearPending;

function Probe() {
  api = useConference();
  return null;
}

const render = async ({
  myId = 'asha',
  call = null,
  connected = true,
  pendingConferenceId = null,
  replies = {},
} = {}) => {
  socket = makeSocket();
  Object.assign(socket.replies, replies); // answers the server gives right from the start
  socket.connected = connected;
  engine = makeEngine();
  clearPending = jest.fn();
  useCall.mockImplementation(() => ({
    socket,
    myId,
    call,
    pendingConferenceId,
    clearPendingConferenceId: clearPending,
  }));
  await ReactTestRenderer.act(async () => {
    screen = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={SAFE_AREA}>
        <ConferenceProvider>
          <Probe />
          <ConferenceRoom />
          <ConferenceInvite />
        </ConferenceProvider>
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
// Is there a piece of text on screen? `wanted` is a string (the whole text) or a RegExp. Text built from several
// parts ({name}{' (you)'}) is joined first.
const hasText = wanted =>
  screen.root.findAll(n => {
    const c = n.props.children;
    const text =
      Array.isArray(c) && c.every(x => ['string', 'number'].includes(typeof x))
        ? c.join('')
        : c;
    return typeof wanted === 'string'
      ? text === wanted
      : typeof text === 'string' && wanted.test(text);
  }).length > 0;
const startsWithText = text =>
  screen.root.findAll(
    n =>
      typeof n.props.children === 'string' && n.props.children.startsWith(text),
  ).length > 0;
const sent = event => socket.sent.filter(s => s.event === event);
const alertText = () => Alert.alert.mock.calls.map(c => c[1]);
const typeNumber = text =>
  screen.root
    .find(
      n =>
        n.props.accessibilityLabel === 'Mobile number to add' &&
        n.props.onChangeText,
    )
    .props.onChangeText(text);

// Asha and Bilal were on a call, someone was added, and Asha joins the conference; Chandni is then in it too
const startedWithThree = async () => {
  await render({ replies: { 'conference:join': joined([ASHA, BILAL]) } });
  engine.accounts = { 101: 'bilal', 102: 'chandni' };
  await act(() => api.joinConference(ID));
  await act(() =>
    socket.serverSends('conference:update', snapshot([ASHA, BILAL, CHANDNI])),
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
  jest.spyOn(Vibration, 'vibrate').mockImplementation(() => {});
  jest.spyOn(Vibration, 'cancel').mockImplementation(() => {});
});
afterEach(async () => {
  await act(() => screen?.unmount());
  screen = null;
  jest.restoreAllMocks();
});

// ---- joining ----

test('when your call became a conference, the app joins it by itself, clears the signal and shows the call screen', async () => {
  await render({
    pendingConferenceId: ID,
    replies: { 'conference:join': joined([ASHA, BILAL]) },
  });
  await act(() => flush());
  expect(sent('conference:join')[0].payload).toEqual({ id: ID });
  expect(clearPending).toHaveBeenCalled();
  expect(engine.initialize).toHaveBeenCalledWith(
    expect.objectContaining({ appId: 'app123' }),
  );
  expect(engine.joinChannelWithUserAccount).toHaveBeenCalledWith(
    '007conf-token',
    'conf-abcdefghij',
    'asha',
    expect.objectContaining({
      publishMicrophoneTrack: true,
      publishCameraTrack: false,
    }), // a voice call stays voice
  );
  expect(api.status).toBe('live');
  expect(api.cameraOn).toBe(false);
  expect(screen.root.findAllByType(Modal)).toHaveLength(1);
  expect(hasText('Group call')).toBe(true);
  expect(hasText(/^2 people · /)).toBe(true);
});

test('a video call that became a conference keeps your camera on', async () => {
  await render({
    replies: { 'conference:join': joined([ASHA, BILAL], { video: true }) },
  });
  await act(() => api.joinConference(ID));
  expect(ensureCallPermissions).toHaveBeenLastCalledWith(true);
  expect(engine.updateChannelMediaOptions).toHaveBeenLastCalledWith({
    publishCameraTrack: true,
  });
  expect(sent('conference:state').at(-1).payload).toEqual({
    id: ID,
    cameraOn: true,
  });
  expect(api.cameraOn).toBe(true);
  expect(byLabel('Switch camera').length).toBeGreaterThan(0);
});

test('a conference cannot be joined when you are not logged in, not connected, or on a call', async () => {
  await render({ myId: null });
  await act(() => api.joinConference(ID));
  expect(sent('conference:join')).toHaveLength(0);
  await act(() => screen.unmount());

  await render({ connected: false });
  await act(() => api.joinConference(ID));
  expect(sent('conference:join')).toHaveLength(0);
  expect(alertText()).toContain(
    'Not connected to the server. Check your internet and try again.',
  );
  await act(() => screen.unmount());

  await render({ call: { id: 'c1', status: 'connected' } });
  await act(() => api.joinConference(ID));
  expect(sent('conference:join')).toHaveLength(0);
  expect(alertText()).toContain(
    'Finish your call before joining a group call.',
  );
  expect(api.status).toBe('idle');
});

test('when the server says no, you are told why and nothing is left half open', async () => {
  const reasons = {
    full: 'That group call is full.',
    ended: 'That group call has ended.',
    'not-found': 'That group call is not available any more.',
    'in-conference': 'You are already in a group call.',
  };
  for (const [error, text] of Object.entries(reasons)) {
    await render({ replies: { 'conference:join': { ok: false, error } } });
    await act(() => api.joinConference(ID));
    expect(alertText()).toContain(text);
    expect(api.status).toBe('idle');
    expect(engine.initialize).not.toHaveBeenCalled();
    await act(() => screen.unmount());
  }
});

// ---- the people ----

test("three people: each is shown, and Agora's events show who has video, who is muted and who is talking", async () => {
  await startedWithThree();
  expect(api.people.map(p => [p.id, p.uid])).toEqual([
    ['asha', 0],
    ['bilal', 101],
    ['chandni', 102],
  ]);
  expect(hasText(/^3 people · /)).toBe(true);
  expect(byLabel('Asha (you)')).not.toHaveLength(0);
  expect(byLabel('Bilal')).not.toHaveLength(0);
  expect(byLabel('Chandni')).not.toHaveLength(0);

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

test('with three people on a tall screen one is on the big tile and tapping another puts them there', async () => {
  await startedWithThree();
  expect(byLabel('Main speaker')).not.toHaveLength(0);
  expect(byLabel('Show Chandni on the big screen')).not.toHaveLength(0); // Bilal is on the stage
  expect(byLabel('Show Bilal on the big screen')).toHaveLength(0);

  await act(() => button('Show Chandni on the big screen').props.onPress());
  expect(byLabel('Show Chandni on the big screen')).toHaveLength(0);
  expect(byLabel('Show Bilal on the big screen')).not.toHaveLength(0);

  await act(() => button('Main speaker').props.onPress()); // back to automatic
  expect(byLabel('Show Chandni on the big screen')).not.toHaveLength(0);
});

test('only the people on screen have their video downloaded', async () => {
  await startedWithThree();
  expect(engine.muteRemoteVideoStream).toHaveBeenCalledWith(101, false);
  expect(engine.muteRemoteVideoStream).toHaveBeenCalledWith(102, false);
});

test('an update about another conference is ignored, and one about this one replaces the list', async () => {
  await startedWithThree();
  await act(() =>
    socket.serverSends('conference:update', {
      ...snapshot([ASHA]),
      id: 'zzzzzzzzzz',
    }),
  );
  expect(api.people).toHaveLength(3);
  await act(() =>
    socket.serverSends('conference:update', snapshot([ASHA, BILAL])),
  );
  expect(api.people.map(p => p.id)).toEqual(['asha', 'bilal']);
});

test('with 100 people only a few have a tile, only they are downloaded, and the People list draws just what is on screen', async () => {
  const everyone = [
    ASHA,
    ...Array.from({ length: 99 }, (_, i) =>
      person(`p${i + 2}`, `Person ${i + 2}`),
    ),
  ];
  await render({ replies: { 'conference:join': joined(everyone) } });
  await act(() => api.joinConference(ID));
  await act(() => {
    for (let i = 2; i <= 100; i++) {
      engine.accounts[1000 + i] = `p${i}`;
      engine.handler.onUserJoined({}, 1000 + i, 0);
    }
  });
  expect(api.people).toHaveLength(100);
  expect(hasText(/^100 people · /)).toBe(true);

  // 8 tiles and a "+N" tile: the rest are heard, not seen
  expect(byLabel('Asha (you)')).not.toHaveLength(0);
  expect(byLabel('Person 8')).not.toHaveLength(0);
  expect(byLabel('Person 9')).toHaveLength(0);
  expect(byLabel('92 more people')).not.toHaveLength(0);
  expect(engine.muteRemoteVideoStream).toHaveBeenCalledWith(1002, false);
  expect(engine.muteRemoteVideoStream).toHaveBeenCalledWith(1050, true);

  await act(() => button('92 more people').props.onPress());
  expect(hasText('People (100)')).toBe(true);
  expect(hasText('Person 10')).toBe(true);
  expect(hasText('Person 90')).toBe(false); // not drawn until you scroll to it
});

// ---- mic, camera, speaker, leaving ----

test('mute, camera, flip and speaker work, and the others are told about the mic and camera', async () => {
  await startedWithThree();
  await act(() => button('Mute').props.onPress());
  expect(engine.muteLocalAudioStream).toHaveBeenLastCalledWith(true);
  expect(sent('conference:state').at(-1).payload).toEqual({
    id: ID,
    muted: true,
  });
  expect(byLabel('Unmute')).not.toHaveLength(0);
  expect(api.people[0].muted).toBe(true);

  expect(byLabel('Switch camera')).toHaveLength(0); // only while the camera is on
  await act(() => button('Turn camera on').props.onPress());
  expect(ensureCallPermissions).toHaveBeenLastCalledWith(true);
  expect(engine.updateChannelMediaOptions).toHaveBeenLastCalledWith({
    publishCameraTrack: true,
  });
  expect(sent('conference:state').at(-1).payload).toEqual({
    id: ID,
    cameraOn: true,
  });
  expect(api.people[0].videoOn).toBe(true);

  await act(() => button('Switch camera').props.onPress());
  expect(engine.switchCamera).toHaveBeenCalled();

  await act(() => button('Speaker').props.onPress());
  expect(engine.setEnableSpeakerphone).toHaveBeenLastCalledWith(false);

  await act(() => button('Turn camera off').props.onPress());
  expect(sent('conference:state').at(-1).payload).toEqual({
    id: ID,
    cameraOn: false,
  });
  expect(byLabel('Switch camera')).toHaveLength(0);
});

test('without camera permission the camera stays off', async () => {
  await startedWithThree();
  ensureCallPermissions.mockImplementation(async video => !video);
  await act(() => button('Turn camera on').props.onPress());
  expect(api.cameraOn).toBe(false);
  expect(alertText()).toContain('Allow camera access to turn on your video.');
  expect(sent('conference:state')).toHaveLength(0);
});

test('Leave tells the server, leaves Agora and closes the screen', async () => {
  await startedWithThree();
  await act(() => button('Leave call').props.onPress());
  expect(sent('conference:leave')[0].payload).toEqual({ id: ID });
  expect(engine.leaveChannel).toHaveBeenCalled();
  expect(engine.release).toHaveBeenCalled();
  expect(api.status).toBe('idle');
  expect(screen.root.findAllByType(Modal)).toHaveLength(0);
});

test('Minimize shrinks the call to a bar, and tapping the bar brings the call screen back', async () => {
  await startedWithThree();
  await act(() => button('Minimize call').props.onPress());
  expect(byLabel('Leave call')).toHaveLength(0);
  expect(screen.root.findAllByType(Modal)).toHaveLength(0);
  expect(byLabel('Return to call')).not.toHaveLength(0);
  expect(api.status).toBe('live'); // still in the call
  await act(() => button('Return to call').props.onPress());
  expect(byLabel('Leave call')).not.toHaveLength(0);
});

test('when the conference ends because you are the only one left, you are told and the screen closes', async () => {
  await startedWithThree();
  await act(() =>
    socket.serverSends('conference:ended', {
      id: 'zzzzzzzzzz',
      reason: 'alone',
    }),
  );
  expect(api.status).toBe('live'); // another conference: ignored
  await act(() =>
    socket.serverSends('conference:ended', { id: ID, reason: 'alone' }),
  );
  expect(alertText()).toContain('Everyone else has left the call.');
  expect(api.status).toBe('idle');
  expect(engine.leaveChannel).toHaveBeenCalled();
});

test('an empty conference closes quietly', async () => {
  await startedWithThree();
  await act(() =>
    socket.serverSends('conference:ended', { id: ID, reason: 'empty' }),
  );
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(api.status).toBe('idle');
});

// ---- the connection ----

test('a token about to expire is replaced with a fresh one from the server', async () => {
  await startedWithThree();
  socket.replies['conference:token'] = {
    ok: true,
    join: { ...JOIN, token: '007fresh' },
  };
  await act(() => engine.handler.onTokenPrivilegeWillExpire({}, 'old'));
  expect(sent('conference:token')[0].payload).toEqual({ id: ID });
  expect(engine.renewToken).toHaveBeenCalledWith('007fresh');
});

test('when the connection to the server comes back the app asks to be put back in the call; if that fails the call closes', async () => {
  await startedWithThree();
  socket.replies['conference:join'] = joined([ASHA, BILAL, CHANDNI]);
  await act(() => socket.serverSends('connect'));
  expect(sent('conference:join')).toHaveLength(2);
  expect(sent('conference:join')[1].payload).toEqual({ id: ID });
  expect(api.status).toBe('live');

  socket.replies['conference:join'] = { ok: false, error: 'ended' };
  await act(() => socket.serverSends('connect'));
  expect(alertText()).toContain('That group call has ended.');
  expect(api.status).toBe('idle');
});

test("Agora's reconnecting and failure are shown, and a failed connection leaves the call", async () => {
  await startedWithThree();
  await act(() => engine.handler.onConnectionStateChanged({}, 4)); // reconnecting
  expect(api.connection).toBe('reconnecting');
  expect(hasText('Reconnecting…')).toBe(true);
  await act(() => engine.handler.onConnectionStateChanged({}, 3)); // connected again
  expect(api.connection).toBe('connected');

  await act(() => engine.handler.onConnectionStateChanged({}, 5)); // failed
  expect(sent('conference:leave')[0].payload).toEqual({ id: ID });
  expect(alertText()).toContain('The connection to the group call was lost.');
  expect(api.status).toBe('idle');
});

test('logging out leaves the call', async () => {
  await startedWithThree();
  useCall.mockImplementation(() => ({
    socket: null,
    myId: null,
    call: null,
    pendingConferenceId: null,
    clearPendingConferenceId: clearPending,
  }));
  await act(() =>
    screen.update(
      <SafeAreaProvider initialMetrics={SAFE_AREA}>
        <ConferenceProvider>
          <Probe />
          <ConferenceRoom />
          <ConferenceInvite />
        </ConferenceProvider>
      </SafeAreaProvider>,
    ),
  );
  expect(api.status).toBe('idle');
});

// ---- adding people by number ----

test('"Add person" rings a number: it is cleaned up, sent, and the card closes', async () => {
  await startedWithThree();
  await act(() => button('Add person').props.onPress());
  expect(byLabel('Mobile number to add')).not.toHaveLength(0);

  socket.replies['conference:invite'] = {
    ok: true,
    invited: { id: '9876543210', name: 'Dev' },
  };
  await act(() => typeNumber('+91 98765-43210'));
  await act(() => button('Add this number').props.onPress());
  expect(sent('conference:invite')[0].payload).toEqual({
    id: ID,
    to: '9876543210',
  });
  expect(byLabel('Mobile number to add')).toHaveLength(0);
  expect(api.notice).toBe('Ringing Dev…');
  expect(hasText('Ringing Dev…')).toBe(true);
});

test('a number that is not valid is not sent, and a refusal from the server is explained on the card', async () => {
  await startedWithThree();
  await act(() => button('Add person').props.onPress());

  await act(() => typeNumber('12345'));
  await act(() => button('Add this number').props.onPress());
  expect(sent('conference:invite')).toHaveLength(0);
  expect(hasText('Enter a valid 10-digit mobile number.')).toBe(true);

  const cases = {
    offline: 'They are not using Atiya Herbs right now.',
    busy: 'They are on another call.',
    'already-in': 'They are already in this call.',
    'already-invited': 'They are already being rung.',
    full: 'This call is full.',
    self: 'That is your own number.',
  };
  for (const [error, text] of Object.entries(cases)) {
    socket.replies['conference:invite'] = { ok: false, error };
    await act(() => typeNumber('98765 43210'));
    await act(() => button('Add this number').props.onPress());
    expect(startsWithText(text)).toBe(true);
    expect(byLabel('Mobile number to add')).not.toHaveLength(0); // the card stays so another number can be tried
  }
  await act(() => button('Cancel adding').props.onPress());
  expect(byLabel('Mobile number to add')).toHaveLength(0);
});

test('people being rung are listed as "Ringing…", and you can stop only the ringing you started', async () => {
  await startedWithThree();
  await act(() =>
    socket.serverSends(
      'conference:update',
      snapshot([ASHA, BILAL, CHANDNI], {
        invited: [
          { id: 'dev', name: 'Dev', by: 'asha' },
          { id: 'ravi', name: 'Ravi', by: 'bilal' },
        ],
      }),
    ),
  );
  expect(api.invited.map(i => i.id)).toEqual(['dev', 'ravi']);
  await act(() => button('People in the call').props.onPress());
  expect(hasText('Ringing…')).toBe(true);
  expect(byLabel('Stop ringing Dev')).not.toHaveLength(0); // Asha (you) rang Dev
  expect(byLabel('Stop ringing Ravi')).toHaveLength(0); // Bilal rang Ravi

  socket.replies['conference:cancel-invite'] = { ok: true };
  await act(() => button('Stop ringing Dev').props.onPress());
  expect(sent('conference:cancel-invite')[0].payload).toEqual({
    id: ID,
    userId: 'dev',
  });
});

test('you are told when someone you rang says no or does not answer', async () => {
  await startedWithThree();
  await act(() =>
    socket.serverSends('conference:invite-result', {
      id: ID,
      to: 'dev',
      name: 'Dev',
      result: 'declined',
    }),
  );
  expect(api.notice).toBe('Dev declined.');
  await act(() =>
    socket.serverSends('conference:invite-result', {
      id: ID,
      to: 'ravi',
      name: 'Ravi',
      result: 'no-answer',
    }),
  );
  expect(api.notice).toBe('Ravi did not answer.');
  await act(() =>
    socket.serverSends('conference:invite-result', {
      id: 'zzzzzzzzzz',
      to: 'x',
      name: 'X',
      result: 'declined',
    }),
  );
  expect(api.notice).toBe('Ravi did not answer.'); // another conference: ignored
});

test('numbers cannot be added when there is no conference', async () => {
  await render();
  let result;
  await act(async () => {
    result = await api.inviteByNumber('98765 43210');
  });
  expect(result).toEqual({ ok: false, error: 'not-active' });
  expect(sent('conference:invite')).toHaveLength(0);
});

// ---- being added: the ringing screen ----

const INVITATION = {
  id: ID,
  from: { id: '9123456780', name: 'Bilal' },
  video: false,
  ttlMs: 45000,
};

test('someone adding you rings like a call: Accept joins the conference, and the ringing stops', async () => {
  await render({
    myId: 'dev',
    replies: {
      'conference:join': joined([ASHA, BILAL, person('dev', 'Dev')]),
    },
  });
  await act(() => socket.serverSends('conference:invitation', INVITATION));
  expect(api.invitation).toEqual(INVITATION);
  expect(byLabel('Accept')).not.toHaveLength(0);
  expect(byLabel('Decline')).not.toHaveLength(0);
  expect(hasText('Bilal')).toBe(true);
  expect(hasText('Atiya Herbs group voice call')).toBe(true);
  expect(Vibration.vibrate).toHaveBeenCalledWith([0, 800, 1200], true);

  await act(() => button('Accept').props.onPress());
  expect(sent('conference:join')[0].payload).toEqual({ id: ID });
  expect(api.invitation).toBeNull();
  expect(api.status).toBe('live');
  expect(Vibration.cancel).toHaveBeenCalled();
  expect(byLabel('Accept')).toHaveLength(0);
});

test('a video invitation says so', async () => {
  await render({ myId: 'dev' });
  await act(() =>
    socket.serverSends('conference:invitation', { ...INVITATION, video: true }),
  );
  expect(hasText('Atiya Herbs group video call')).toBe(true);
});

test('Decline tells the server and closes the ringing screen', async () => {
  await render({ myId: 'dev' });
  await act(() => socket.serverSends('conference:invitation', INVITATION));
  await act(() => button('Decline').props.onPress());
  expect(sent('conference:decline')[0].payload).toEqual({ id: ID });
  expect(api.invitation).toBeNull();
  expect(sent('conference:join')).toHaveLength(0);
  expect(api.status).toBe('idle');
});

test("the ringing screen closes when the ringing stops (cancelled or timed out); another conference's message is ignored", async () => {
  await render({ myId: 'dev' });
  await act(() => socket.serverSends('conference:invitation', INVITATION));
  await act(() =>
    socket.serverSends('conference:invitation-ended', { id: 'zzzzzzzzzz' }),
  );
  expect(api.invitation).not.toBeNull();
  await act(() =>
    socket.serverSends('conference:invitation-ended', { id: ID }),
  );
  expect(api.invitation).toBeNull();
  expect(Vibration.cancel).toHaveBeenCalled();
});

test('if you are already in a conference or on a call, an invitation is turned down without a screen', async () => {
  await startedWithThree();
  await act(() =>
    socket.serverSends('conference:invitation', {
      ...INVITATION,
      id: 'zzzzzzzzzz',
    }),
  );
  expect(api.invitation).toBeNull();
  expect(sent('conference:decline').at(-1).payload).toEqual({
    id: 'zzzzzzzzzz',
  });

  await act(() => screen.unmount());
  await render({ myId: 'dev', call: { id: 'c1', status: 'connected' } });
  await act(() => socket.serverSends('conference:invitation', INVITATION));
  expect(api.invitation).toBeNull();
  expect(sent('conference:decline')[0].payload).toEqual({ id: ID });
});
