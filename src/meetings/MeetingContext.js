import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Alert, Linking, Platform, Vibration } from 'react-native';
import { useCall } from '../calling/CallContext';
import { ensureCallPermissions } from '../calling/permissions';
import { joinGroupChannel } from '../calling/groupAgora';
import { normalizeMobile } from '../calling/phone';
import { parseMeetingLink } from './meetingLayout';

// Group video meetings (Zoom / Google Meet style). Everyone in a meeting joins ONE Agora channel; the call server
// (call-backend/src/meetings.js, over the same Socket.IO connection the one-to-one calls use) keeps who is in it,
// the chat, and what the host may do, and makes each person's Agora token. This file holds the meeting's state for
// the screens: MeetingsScreen (start / join) and MeetingRoom (the meeting itself).
//
// The one-to-one LiveKit calls in src/calling are not touched: a person is in a call OR a meeting, never both.

const MeetingContext = createContext(null);

// Why the server (or the phone) said no -> what we tell the user
const MEETING_ERRORS = {
  'not-configured': 'Meetings are not set up on the server yet.',
  'in-call': 'Finish your call before joining a meeting.',
  'in-meeting': 'You are already in a meeting.',
  'not-found': 'No meeting with that id. Check it and try again.',
  ended: 'That meeting has ended.',
  removed: 'The host removed you from that meeting.',
  locked: 'The host has locked that meeting.',
  full: 'That meeting is full.',
  'slow-down': 'Please wait a moment and try again.',
  'no-recipient': 'Choose who to send the message to.',
  timeout: 'The server did not answer. Check your internet and try again.',
  failed: 'Something went wrong. Please try again.',
};

const NOBODY = []; // one shared empty list, so an empty "being rung" list does not look like a change each time

const SPEAKING_VOLUME = 30; // of 255: below this it is background noise
const NOTICE_MS = 4000;
const ASK_TIMEOUT_MS = 8000;

export function MeetingProvider({ children }) {
  const { socket, myId, call } = useCall();
  const callActive = !!call && call.status !== 'ended';

  const [status, setStatus] = useState('idle'); // idle | joining | live
  const [meeting, setMeeting] = useState(null); // the server's picture of it: title, host, people, locked
  const [chat, setChat] = useState([]);
  const [receipts, setReceipts] = useState({}); // messageId -> {delivered: {userId: true}, seen: {userId: true}}
  const [unread, setUnread] = useState(0);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [frontCamera, setFrontCamera] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [connection, setConnection] = useState('connected'); // connected | reconnecting
  const [notice, setNotice] = useState(null); // a short message shown on the meeting screen
  // Agora's picture of the others: its uid for each person, who has video, who is muted, who is talking
  const [uidByAccount, setUidByAccount] = useState({});
  const [videoUids, setVideoUids] = useState({});
  const [mutedUids, setMutedUids] = useState({});
  const [speakingUid, setSpeakingUid] = useState(null);
  // Someone is ringing you to join a meeting: {id, title, from: {id, name}}, until you answer or it stops
  const [invitation, setInvitation] = useState(null);

  // callbacks from the socket and Agora read these, so they always see the latest values
  const engineRef = useRef(null);
  const meetingIdRef = useRef(null);
  const statusRef = useRef('idle');
  const chatOpenRef = useRef(false);
  const chatRef = useRef([]);
  const seenSentRef = useRef(new Set()); // my 'seen' receipts already sent
  const seenChatRef = useRef(new Set()); // ids of the chat messages already shown, so none is added or counted twice
  const noticeTimer = useRef(null);
  const myIdRef = useRef(myId);
  myIdRef.current = myId;
  const callActiveRef = useRef(callActive);
  callActiveRef.current = callActive;

  const setStatusBoth = next => {
    statusRef.current = next;
    setStatus(next);
  };

  const showNotice = useCallback(text => {
    setNotice(text);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  // One question to the server with a time limit, so a lost connection never leaves the screen waiting forever
  const ask = useCallback(
    (event, payload) =>
      new Promise(resolve => {
        if (!socket?.connected) {
          resolve({ ok: false, error: 'timeout' });
          return;
        }
        let done = false;
        const timer = setTimeout(() => {
          done = true;
          resolve({ ok: false, error: 'timeout' });
        }, ASK_TIMEOUT_MS);
        socket.emit(event, payload, res => {
          if (!done) {
            done = true;
            clearTimeout(timer);
            resolve(res || { ok: false, error: 'failed' });
          }
        });
      }),
    [socket],
  );

  // Leaves Agora and puts every part of the screen back to "no meeting"
  const teardown = useCallback(() => {
    engineRef.current?.leave();
    engineRef.current = null;
    meetingIdRef.current = null;
    chatOpenRef.current = false;
    seenChatRef.current = new Set();
    statusRef.current = 'idle';
    clearTimeout(noticeTimer.current);
    setStatus('idle');
    setMeeting(null);
    chatRef.current = [];
    setChat([]);
    setReceipts({});
    seenSentRef.current = new Set();
    setUnread(0);
    setMuted(false);
    setCameraOn(false);
    setSpeakerOn(true);
    setFrontCamera(true);
    setSharing(false);
    setConnection('connected');
    setNotice(null);
    setUidByAccount({});
    setVideoUids({});
    setMutedUids({});
    setSpeakingUid(null);
  }, []);

  // close the ringing screen and stop the vibration
  const clearInvitation = useCallback(() => {
    Vibration.cancel();
    setInvitation(null);
  }, []);

  const endedByServer = useCallback(
    message => {
      teardown();
      if (message) {
        Alert.alert('Meeting', message);
      }
    },
    [teardown],
  );

  // What Agora reports about the other people in the meeting
  const agoraHandlers = useMemo(
    () => ({
      onUserJoined: (uid, account) => {
        if (account) {
          setUidByAccount(map => ({ ...map, [account]: uid }));
        }
      },
      onUserOffline: uid => {
        setUidByAccount(map =>
          Object.fromEntries(Object.entries(map).filter(([, u]) => u !== uid)),
        );
        setVideoUids(map => ({ ...map, [uid]: false }));
        setMutedUids(map => ({ ...map, [uid]: false }));
      },
      onRemoteVideo: (uid, on) => setVideoUids(map => ({ ...map, [uid]: on })),
      onRemoteMuted: (uid, isMuted) =>
        setMutedUids(map => ({ ...map, [uid]: isMuted })),
      onSpeakers: list => {
        const loud = list
          .filter(s => s.volume >= SPEAKING_VOLUME)
          .sort((a, b) => b.volume - a.volume)[0];
        setSpeakingUid(loud ? loud.uid : null);
      },
      onReconnecting: () => setConnection('reconnecting'),
      onReconnected: () => setConnection('connected'),
      onFailed: () => {
        const id = meetingIdRef.current;
        if (id) {
          socket?.emit('meeting:leave', { id });
        }
        endedByServer('The connection to the meeting was lost.');
      },
    }),
    [socket, endedByServer],
  );

  // Joins the Agora channel with what the server gave (it made the token) and shows the meeting
  const enter = useCallback(
    async res => {
      const handlers = {
        ...agoraHandlers,
        onTokenWillExpire: async () => {
          const id = meetingIdRef.current;
          const next = id && (await ask('meeting:token', { id }));
          if (next?.ok) {
            engineRef.current?.renewToken(next.join.token);
          }
        },
        onShareStopped: () => {
          const id = meetingIdRef.current;
          engineRef.current?.stopScreenShare();
          setSharing(false);
          if (id) {
            ask('meeting:share', { id, sharing: false });
          }
        },
      };
      const agora = await joinGroupChannel({ ...res.join, handlers });
      if (statusRef.current !== 'joining') {
        agora.leave(); // the person left while it was still connecting
        return false;
      }
      engineRef.current = agora;
      meetingIdRef.current = res.meeting.id;
      seenChatRef.current = new Set((res.chat || []).map(m => m.id));
      agora.setSpeaker(true);
      setMeeting(res.meeting);
      chatRef.current = res.chat || [];
      setChat(res.chat || []);
      setStatusBoth('live');
      return true;
    },
    [agoraHandlers, ask],
  );

  const canStart = useCallback(async () => {
    if (!myId) {
      Alert.alert(
        'Meetings',
        'Log in with your mobile number to use meetings.',
      );
      return false;
    }
    if (statusRef.current !== 'idle') {
      return false;
    }
    if (!socket?.connected) {
      Alert.alert(
        'Meetings',
        'Not connected to the server. Check your internet and try again.',
      );
      return false;
    }
    if (callActive) {
      Alert.alert('Meetings', MEETING_ERRORS['in-call']);
      return false;
    }
    if (!(await ensureCallPermissions(false))) {
      Alert.alert(
        'Permission needed',
        'Allow microphone access to join a meeting.',
      );
      return false;
    }
    return true;
  }, [myId, socket, callActive]);

  const begin = useCallback(
    async (event, payload) => {
      if (!(await canStart())) {
        return false;
      }
      setStatusBoth('joining');
      const res = await ask(event, payload);
      if (!res.ok) {
        setStatusBoth('idle');
        Alert.alert(
          'Meetings',
          MEETING_ERRORS[res.error] || MEETING_ERRORS.failed,
        );
        return false;
      }
      try {
        if (await enter(res)) {
          return true;
        }
        return false;
      } catch (e) {
        console.warn('Could not join the meeting', e);
        socket?.emit('meeting:leave', { id: res.meeting.id });
        teardown();
        Alert.alert(
          'Meetings',
          'Could not connect to the meeting. Please try again.',
        );
        return false;
      }
    },
    [canStart, ask, enter, socket, teardown],
  );

  const createMeeting = useCallback(
    title => begin('meeting:create', { title }),
    [begin],
  );
  const joinMeeting = useCallback(id => begin('meeting:join', { id }), [begin]);

  const leaveMeeting = useCallback(() => {
    const id = meetingIdRef.current;
    if (id) {
      socket?.emit('meeting:leave', { id });
    }
    teardown();
  }, [socket, teardown]);

  const endMeeting = useCallback(() => {
    const id = meetingIdRef.current;
    if (id) {
      socket?.emit('meeting:end', { id });
    }
    teardown();
  }, [socket, teardown]);

  const sendState = useCallback(
    fields => {
      const id = meetingIdRef.current;
      if (id) {
        socket?.emit('meeting:state', { id, ...fields });
      }
    },
    [socket],
  );

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    engineRef.current?.setMuted(next);
    sendState({ muted: next });
  }, [muted, sendState]);

  const toggleCamera = useCallback(async () => {
    const agora = engineRef.current;
    if (!agora) {
      return;
    }
    if (agora.sharing) {
      showNotice('Stop sharing your screen to use the camera.');
      return;
    }
    const turnOn = !cameraOn;
    if (turnOn && !(await ensureCallPermissions(true))) {
      Alert.alert(
        'Permission needed',
        'Allow camera access to turn on your video.',
      );
      return;
    }
    try {
      agora.setCamera(turnOn);
      setCameraOn(turnOn);
      sendState({ cameraOn: turnOn });
    } catch (e) {
      Alert.alert('Meetings', 'Could not open the camera.');
    }
  }, [cameraOn, sendState, showNotice]);

  const flipCamera = useCallback(() => {
    engineRef.current?.switchCamera();
    setFrontCamera(front => !front);
  }, []);

  const toggleSpeaker = useCallback(() => {
    const next = !speakerOn;
    setSpeakerOn(next);
    engineRef.current?.setSpeaker(next);
  }, [speakerOn]);

  const toggleScreenShare = useCallback(async () => {
    const agora = engineRef.current;
    const id = meetingIdRef.current;
    if (!agora || !id) {
      return;
    }
    if (Platform.OS !== 'android') {
      Alert.alert(
        'Meetings',
        'Screen sharing is available on Android for now.',
      );
      return;
    }
    if (sharing) {
      agora.stopScreenShare();
      setSharing(false);
      ask('meeting:share', { id, sharing: false });
      return;
    }
    const res = await ask('meeting:share', { id, sharing: true });
    if (!res.ok) {
      Alert.alert(
        'Meetings',
        res.error === 'busy'
          ? `${res.by || 'Someone'} is already sharing their screen.`
          : MEETING_ERRORS[res.error] || MEETING_ERRORS.failed,
      );
      return;
    }
    try {
      agora.startScreenShare();
      setSharing(true);
    } catch (e) {
      ask('meeting:share', { id, sharing: false });
      Alert.alert('Meetings', 'Could not start screen sharing.');
    }
  }, [sharing, ask]);

  const sendChat = useCallback(
    // `to` is the id of the one person it goes to, or 'all' when the person chose everyone
    async (text, to) => {
      const id = meetingIdRef.current;
      if (!id || !text.trim() || !to) {
        return false;
      }
      const res = await ask('meeting:chat', { id, text, to });
      if (!res.ok) {
        showNotice(MEETING_ERRORS[res.error] || 'The message was not sent.');
      }
      return !!res.ok;
    },
    [ask, showNotice],
  );

  // The chat panel tells us when it is open, so new messages while it is shut can be counted
  const setChatOpen = useCallback(open => {
    chatOpenRef.current = open;
    if (open) {
      setUnread(0);
      const id = meetingIdRef.current;
      const unseen = chatRef.current
        .filter(m => m.from.id !== myIdRef.current && !seenSentRef.current.has(m.id))
        .map(m => m.id);
      if (id && unseen.length) {
        unseen.forEach(mid => seenSentRef.current.add(mid));
        ask('meeting:chat-receipt', { id, messageIds: unseen, state: 'seen' });
      }
    }
  }, [ask]);

  // ---- host controls (the server refuses them from anyone else) ----
  const hostAction = useCallback(
    async (event, fields, okNotice) => {
      const id = meetingIdRef.current;
      if (!id) {
        return false;
      }
      const res = await ask(event, { id, ...fields });
      if (res.ok && okNotice) {
        showNotice(okNotice);
      }
      if (!res.ok) {
        showNotice(
          res.error === 'host-only'
            ? 'Only the host can do that.'
            : MEETING_ERRORS[res.error] || MEETING_ERRORS.failed,
        );
      }
      return !!res.ok;
    },
    [ask, showNotice],
  );
  const muteParticipant = useCallback(
    userId => hostAction('meeting:mute', { userId }, 'Asked them to mute.'),
    [hostAction],
  );
  const muteAll = useCallback(
    () =>
      hostAction('meeting:mute', { userId: 'all' }, 'Asked everyone to mute.'),
    [hostAction],
  );
  const removeParticipant = useCallback(
    userId =>
      hostAction('meeting:remove', { userId }, 'Removed from the meeting.'),
    [hostAction],
  );
  const setLocked = useCallback(
    locked =>
      hostAction(
        'meeting:lock',
        { locked },
        locked ? 'Meeting locked. No one new can join.' : 'Meeting unlocked.',
      ),
    [hostAction],
  );

  // Ring a mobile number into this meeting. Anyone in the meeting may do this. Resolves to {ok, invited} or {ok: false, error}.
  const inviteByNumber = useCallback(
    async raw => {
      const id = meetingIdRef.current;
      const to = normalizeMobile(raw);
      if (!id) {
        return { ok: false, error: 'not-active' };
      }
      if (!to) {
        return { ok: false, error: 'invalid-number' };
      }
      const res = await ask('meeting:invite', { id, to });
      if (res.ok) {
        showNotice(`Ringing ${res.invited?.name || to}…`);
      }
      return res;
    },
    [ask, showNotice],
  );
  const cancelInvite = useCallback(
    userId => hostAction('meeting:cancel-invite', { userId }),
    [hostAction],
  );

  // The ringing screen: Accept joins the meeting, Decline tells the person who rang
  const acceptInvitation = useCallback(async () => {
    const id = invitation?.id;
    clearInvitation();
    if (id) {
      await joinMeeting(id);
    }
  }, [invitation, clearInvitation, joinMeeting]);
  const declineInvitation = useCallback(() => {
    const id = invitation?.id;
    clearInvitation();
    if (id) {
      socket?.emit('meeting:decline', { id });
    }
  }, [invitation, clearInvitation, socket]);

  const listMeetings = useCallback(async () => {
    const res = await ask('meeting:list', {});
    return res.ok ? res.meetings : [];
  }, [ask]);

  // Only the people on screen need their video downloaded: the rest are heard but not seen
  const setVisibleAccounts = useCallback(
    accounts => {
      const shown = new Set(accounts);
      for (const [account, uid] of Object.entries(uidByAccount)) {
        engineRef.current?.setRemoteVideoShown(uid, shown.has(account));
      }
    },
    [uidByAccount],
  );

  // ---- what the server tells us ----
  useEffect(() => {
    if (!socket) {
      return undefined;
    }
    const isMine = data => data?.id === meetingIdRef.current;

    const onUpdate = data => {
      if (isMine(data)) {
        setMeeting(data);
      }
    };
    const onChat = ({ id, message }) => {
      if (id !== meetingIdRef.current) {
        return;
      }
      if (seenChatRef.current.has(message.id)) {
        return;
      }
      seenChatRef.current.add(message.id);
      chatRef.current = [...chatRef.current, message];
      setChat(list => [...list, message]);
      if (message.from.id !== myIdRef.current) {
        const seen = chatOpenRef.current;
        if (seen) {
          seenSentRef.current.add(message.id);
        } else {
          setUnread(count => count + 1);
        }
        ask('meeting:chat-receipt', {
          id,
          messageIds: [message.id],
          state: seen ? 'seen' : 'delivered',
        });
      }
    };
    const onReceipt = ({ id, messageIds, userId, state }) => {
      if (id !== meetingIdRef.current) {
        return;
      }
      setReceipts(all => {
        const next = { ...all };
        for (const mid of messageIds) {
          const r = next[mid] || { delivered: {}, seen: {} };
          next[mid] = {
            delivered: { ...r.delivered, [userId]: true },
            seen: state === 'seen' ? { ...r.seen, [userId]: true } : r.seen,
          };
        }
        return next;
      });
    };
    const onMuteRequest = ({ id, by }) => {
      if (id !== meetingIdRef.current) {
        return;
      }
      setMuted(true);
      engineRef.current?.setMuted(true);
      socket.emit('meeting:state', { id, muted: true });
      showNotice(`${by?.name || 'The host'} muted you.`);
    };
    const onRemoved = data => {
      if (isMine(data)) {
        endedByServer('The host removed you from the meeting.');
      }
    };
    const onEnded = data => {
      if (isMine(data)) {
        endedByServer(
          data.reason === 'host' ? 'The host ended the meeting.' : null,
        );
      }
    };
    // The connection dropped and came back: the server kept our place for a short while, so ask to be put back
    const onReconnect = () => {
      const id = meetingIdRef.current;
      if (!id || statusRef.current !== 'live') {
        return;
      }
      socket.emit('meeting:join', { id }, res => {
        if (!res?.ok) {
          endedByServer(
            MEETING_ERRORS[res?.error] || 'The meeting is no longer available.',
          );
        }
      });
    };

    socket.on('meeting:update', onUpdate);
    socket.on('meeting:chat', onChat);
    socket.on('meeting:chat-receipt', onReceipt);
    socket.on('meeting:mute-request', onMuteRequest);
    socket.on('meeting:removed', onRemoved);
    socket.on('meeting:ended', onEnded);
    const onInvitation = data => {
      // busy right now (a race the server could not see): say no without showing anything
      if (statusRef.current !== 'idle' || callActiveRef.current) {
        socket.emit('meeting:decline', { id: data.id });
        return;
      }
      setInvitation(data);
      Vibration.vibrate([0, 800, 1200], true);
    };
    const onInvitationEnded = data => {
      setInvitation(current => {
        if (current?.id === data?.id) {
          Vibration.cancel();
          return null;
        }
        return current;
      });
    };
    // what happened to someone you rang
    const onInviteResult = ({ id, name, result }) => {
      if (id !== meetingIdRef.current) {
        return;
      }
      showNotice(
        result === 'declined' ? `${name} declined.` : `${name} did not answer.`,
      );
    };
    socket.on('meeting:invitation', onInvitation);
    socket.on('meeting:invitation-ended', onInvitationEnded);
    socket.on('meeting:invite-result', onInviteResult);
    socket.on('connect', onReconnect);
    return () => {
      socket.off('meeting:update', onUpdate);
      socket.off('meeting:chat', onChat);
      socket.off('meeting:chat-receipt', onReceipt);
      socket.off('meeting:mute-request', onMuteRequest);
      socket.off('meeting:removed', onRemoved);
      socket.off('meeting:ended', onEnded);
      socket.off('meeting:invitation', onInvitation);
      socket.off('meeting:invitation-ended', onInvitationEnded);
      socket.off('meeting:invite-result', onInviteResult);
      socket.off('connect', onReconnect);
    };
  }, [socket, ask, showNotice, endedByServer]);

  // Logging out (or switching account) leaves the meeting
  useEffect(() => {
    if (!socket && statusRef.current !== 'idle') {
      teardown();
    }
  }, [socket, teardown]);

  // Logging out stops any ringing screen
  useEffect(() => {
    if (!socket) {
      clearInvitation();
    }
  }, [socket, clearInvitation]);

  // A meeting link (atiyaherbs://meeting/abc-defg-hij) opens the app and offers to join
  const joinRef = useRef(joinMeeting);
  joinRef.current = joinMeeting;
  useEffect(() => {
    const offer = url => {
      const id = parseMeetingLink(url);
      if (!id) {
        return;
      }
      if (!myIdRef.current) {
        Alert.alert(
          'Meetings',
          'Log in with your mobile number to join this meeting.',
        );
        return;
      }
      Alert.alert('Join meeting', `Join the meeting ${id}?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Join', onPress: () => joinRef.current(id) },
      ]);
    };
    Promise.resolve(Linking.getInitialURL?.())
      .then(offer)
      .catch(() => {});
    const subscription = Linking.addEventListener?.('url', ({ url }) =>
      offer(url),
    );
    return () => subscription?.remove?.();
  }, []);

  // The people in the meeting, with what Agora says about each (video on, muted, talking)
  const people = useMemo(
    () =>
      (meeting?.participants || []).map(p => {
        const isMe = p.id === myId;
        const uid = isMe ? 0 : uidByAccount[p.id];
        return {
          ...p,
          isMe,
          uid,
          videoOn: isMe ? cameraOn || sharing : !!videoUids[uid],
          muted: isMe ? muted : p.muted || !!mutedUids[uid],
          speaking: isMe
            ? speakingUid === 0
            : uid !== undefined && uid === speakingUid,
          sharing: p.sharing,
        };
      }),
    [
      meeting,
      myId,
      uidByAccount,
      videoUids,
      mutedUids,
      speakingUid,
      cameraOn,
      sharing,
      muted,
    ],
  );
  const isHost = !!meeting && meeting.hostId === myId;
  const invited = meeting?.invited || NOBODY;

  const value = useMemo(
    () => ({
      status,
      meeting,
      people,
      isHost,
      chat,
      receipts,
      unread,
      muted,
      cameraOn,
      speakerOn,
      frontCamera,
      sharing,
      connection,
      notice,
      speakingUid,
      createMeeting,
      joinMeeting,
      leaveMeeting,
      endMeeting,
      toggleMute,
      toggleCamera,
      flipCamera,
      toggleSpeaker,
      toggleScreenShare,
      sendChat,
      setChatOpen,
      muteParticipant,
      muteAll,
      removeParticipant,
      setLocked,
      listMeetings,
      setVisibleAccounts,
      invited,
      invitation,
      inviteByNumber,
      cancelInvite,
      acceptInvitation,
      declineInvitation,
    }),
    [
      status,
      meeting,
      people,
      isHost,
      chat,
      receipts,
      unread,
      muted,
      cameraOn,
      speakerOn,
      frontCamera,
      sharing,
      connection,
      notice,
      speakingUid,
      createMeeting,
      joinMeeting,
      leaveMeeting,
      endMeeting,
      toggleMute,
      toggleCamera,
      flipCamera,
      toggleSpeaker,
      toggleScreenShare,
      sendChat,
      setChatOpen,
      muteParticipant,
      muteAll,
      removeParticipant,
      setLocked,
      listMeetings,
      setVisibleAccounts,
      invited,
      invitation,
      inviteByNumber,
      cancelInvite,
      acceptInvitation,
      declineInvitation,
    ],
  );

  return (
    <MeetingContext.Provider value={value}>{children}</MeetingContext.Provider>
  );
}

export function useMeeting() {
  const ctx = useContext(MeetingContext);
  if (!ctx) {
    throw new Error('useMeeting must be used inside MeetingProvider');
  }
  return ctx;
}
