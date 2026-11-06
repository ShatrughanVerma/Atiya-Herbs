import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Alert, Vibration } from 'react-native';
import { useCall } from '../calling/CallContext';
import { ensureCallPermissions } from '../calling/permissions';
import { joinGroupChannel } from '../calling/groupAgora';
import { normalizeMobile } from '../calling/phone';
import { ADD_PERSON_ERRORS } from '../calling/addPersonErrors';

// Conference calls: a one-to-one call that grew into a group call (someone was added by mobile number). Everyone
// joins ONE Agora channel; the call server (call-backend/src/conferences.js, over the same Socket.IO connection the
// calls use) keeps who is in it, rings the people being added and makes each person's Agora token. This file holds
// the conference's state for the screens: ConferenceRoom (the call screen) and ConferenceInvite (the ringing screen).
//
// It is NOT a meeting: there is no id to share, no host, no chat. Everybody has the same rights, and the conference
// ends by itself when only one person is left. Meetings (src/meetings) are a separate feature and share nothing with
// this file except the small Agora helper in src/calling/groupAgora.js.

const ConferenceContext = createContext(null);

// Why the server (or the phone) said no -> what we tell the user
const CONFERENCE_ERRORS = {
  'not-configured': 'Group calls are not set up on the server yet.',
  'in-call': 'Finish your call before joining a group call.',
  'in-conference': 'You are already in a group call.',
  'not-found': 'That group call is not available any more.',
  ended: 'That group call has ended.',
  full: 'That group call is full.',
  timeout: 'The server did not answer. Check your internet and try again.',
  failed: 'Something went wrong. Please try again.',
};

// Why a number could not be rung into the conference -> what we tell the user
export const CONFERENCE_ADD_ERRORS = {
  ...ADD_PERSON_ERRORS,
  'already-in': 'They are already in this call.',
  full: 'This call is full.',
  busy: 'They are on another call.',
  'in-conference': 'You are already in a group call.',
  'not-in-conference': 'You are not in this call any more.',
  'not-active': 'The call is not connected.',
};

const NOBODY = []; // one shared empty list, so an empty "being rung" list does not look like a change each time

const SPEAKING_VOLUME = 30; // of 255: below this it is background noise
const NOTICE_MS = 4000;
const ASK_TIMEOUT_MS = 8000;

export function ConferenceProvider({ children }) {
  const { socket, myId, call, pendingConferenceId, clearPendingConferenceId } =
    useCall();
  const callActive = !!call && call.status !== 'ended';

  const [status, setStatus] = useState('idle'); // idle | joining | live
  const [conference, setConference] = useState(null); // the server's picture of it: people, who is being rung
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [frontCamera, setFrontCamera] = useState(true);
  const [connection, setConnection] = useState('connected'); // connected | reconnecting
  const [notice, setNotice] = useState(null); // a short message shown on the call screen
  // Agora's picture of the others: its uid for each person, who has video, who is muted, who is talking
  const [uidByAccount, setUidByAccount] = useState({});
  const [videoUids, setVideoUids] = useState({});
  const [mutedUids, setMutedUids] = useState({});
  const [speakingUid, setSpeakingUid] = useState(null);
  // Someone is ringing you to join a group call: {id, from: {id, name}, video}, until you answer or it stops
  const [invitation, setInvitation] = useState(null);

  // callbacks from the socket and Agora read these, so they always see the latest values
  const engineRef = useRef(null);
  const conferenceIdRef = useRef(null);
  const statusRef = useRef('idle');
  const noticeTimer = useRef(null);
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

  // Leaves Agora and puts every part of the screen back to "no conference"
  const teardown = useCallback(() => {
    engineRef.current?.leave();
    engineRef.current = null;
    conferenceIdRef.current = null;
    statusRef.current = 'idle';
    clearTimeout(noticeTimer.current);
    setStatus('idle');
    setConference(null);
    setMuted(false);
    setCameraOn(false);
    setSpeakerOn(true);
    setFrontCamera(true);
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
        Alert.alert('Group call', message);
      }
    },
    [teardown],
  );

  // What Agora reports about the other people in the call
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
        const id = conferenceIdRef.current;
        if (id) {
          socket?.emit('conference:leave', { id });
        }
        endedByServer('The connection to the group call was lost.');
      },
    }),
    [socket, endedByServer],
  );

  // Joins the Agora channel with what the server gave (it made the token) and shows the call
  const enter = useCallback(
    async res => {
      const handlers = {
        ...agoraHandlers,
        onTokenWillExpire: async () => {
          const id = conferenceIdRef.current;
          const next = id && (await ask('conference:token', { id }));
          if (next?.ok) {
            engineRef.current?.renewToken(next.join.token);
          }
        },
      };
      const agora = await joinGroupChannel({ ...res.join, handlers });
      if (statusRef.current !== 'joining') {
        agora.leave(); // the person left while it was still connecting
        return false;
      }
      engineRef.current = agora;
      conferenceIdRef.current = res.conference.id;
      agora.setSpeaker(true);
      setConference(res.conference);
      setStatusBoth('live');
      // a video call that became a group call keeps your camera on
      if (res.conference.video && (await ensureCallPermissions(true))) {
        try {
          agora.setCamera(true);
          setCameraOn(true);
          socket?.emit('conference:state', {
            id: res.conference.id,
            cameraOn: true,
          });
        } catch (e) {
          showNotice('Could not open the camera.');
        }
      }
      return true;
    },
    [agoraHandlers, ask, socket, showNotice],
  );

  const canStart = useCallback(async () => {
    if (!myId) {
      return false;
    }
    if (statusRef.current !== 'idle') {
      return false;
    }
    if (!socket?.connected) {
      Alert.alert(
        'Group call',
        'Not connected to the server. Check your internet and try again.',
      );
      return false;
    }
    if (callActive) {
      Alert.alert('Group call', CONFERENCE_ERRORS['in-call']);
      return false;
    }
    if (!(await ensureCallPermissions(false))) {
      Alert.alert(
        'Permission needed',
        'Allow microphone access to join a group call.',
      );
      return false;
    }
    return true;
  }, [myId, socket, callActive]);

  const joinConference = useCallback(
    async id => {
      if (!(await canStart())) {
        return false;
      }
      setStatusBoth('joining');
      const res = await ask('conference:join', { id });
      if (!res.ok) {
        setStatusBoth('idle');
        Alert.alert(
          'Group call',
          CONFERENCE_ERRORS[res.error] || CONFERENCE_ERRORS.failed,
        );
        return false;
      }
      try {
        return await enter(res);
      } catch (e) {
        console.warn('Could not join the group call', e);
        socket?.emit('conference:leave', { id: res.conference.id });
        teardown();
        Alert.alert(
          'Group call',
          'Could not connect to the group call. Please try again.',
        );
        return false;
      }
    },
    [canStart, ask, enter, socket, teardown],
  );

  const leaveConference = useCallback(() => {
    const id = conferenceIdRef.current;
    if (id) {
      socket?.emit('conference:leave', { id });
    }
    teardown();
  }, [socket, teardown]);

  const sendState = useCallback(
    fields => {
      const id = conferenceIdRef.current;
      if (id) {
        socket?.emit('conference:state', { id, ...fields });
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
      Alert.alert('Group call', 'Could not open the camera.');
    }
  }, [cameraOn, sendState]);

  const flipCamera = useCallback(() => {
    engineRef.current?.switchCamera();
    setFrontCamera(front => !front);
  }, []);

  const toggleSpeaker = useCallback(() => {
    const next = !speakerOn;
    setSpeakerOn(next);
    engineRef.current?.setSpeaker(next);
  }, [speakerOn]);

  // Ring a mobile number into this call. Anyone in it may do this. Resolves to {ok, invited} or {ok: false, error}.
  const inviteByNumber = useCallback(
    async raw => {
      const id = conferenceIdRef.current;
      const to = normalizeMobile(raw);
      if (!id) {
        return { ok: false, error: 'not-active' };
      }
      if (!to) {
        return { ok: false, error: 'invalid-number' };
      }
      const res = await ask('conference:invite', { id, to });
      if (res.ok) {
        showNotice(`Ringing ${res.invited?.name || to}…`);
      }
      return res;
    },
    [ask, showNotice],
  );
  const cancelInvite = useCallback(
    async userId => {
      const id = conferenceIdRef.current;
      if (!id) {
        return false;
      }
      const res = await ask('conference:cancel-invite', { id, userId });
      if (!res.ok) {
        showNotice(CONFERENCE_ERRORS[res.error] || CONFERENCE_ERRORS.failed);
      }
      return !!res.ok;
    },
    [ask, showNotice],
  );

  // The ringing screen: Accept joins the call, Decline tells the person who rang
  const acceptInvitation = useCallback(async () => {
    const id = invitation?.id;
    clearInvitation();
    if (id) {
      await joinConference(id);
    }
  }, [invitation, clearInvitation, joinConference]);
  const declineInvitation = useCallback(() => {
    const id = invitation?.id;
    clearInvitation();
    if (id) {
      socket?.emit('conference:decline', { id });
    }
  }, [invitation, clearInvitation, socket]);

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
    const isMine = data => data?.id === conferenceIdRef.current;

    const onUpdate = data => {
      if (isMine(data)) {
        setConference(data);
      }
    };
    const onEnded = data => {
      if (isMine(data)) {
        endedByServer(
          data.reason === 'alone' ? 'Everyone else has left the call.' : null,
        );
      }
    };
    // The connection dropped and came back: the server kept our place for a short while, so ask to be put back
    const onReconnect = () => {
      const id = conferenceIdRef.current;
      if (!id || statusRef.current !== 'live') {
        return;
      }
      socket.emit('conference:join', { id }, res => {
        if (!res?.ok) {
          endedByServer(
            CONFERENCE_ERRORS[res?.error] ||
              'The group call is no longer available.',
          );
        }
      });
    };
    const onInvitation = data => {
      // busy right now (a race the server could not see): say no without showing anything
      if (statusRef.current !== 'idle' || callActiveRef.current) {
        socket.emit('conference:decline', { id: data.id });
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
      if (id !== conferenceIdRef.current) {
        return;
      }
      showNotice(
        result === 'declined' ? `${name} declined.` : `${name} did not answer.`,
      );
    };

    socket.on('conference:update', onUpdate);
    socket.on('conference:ended', onEnded);
    socket.on('conference:invitation', onInvitation);
    socket.on('conference:invitation-ended', onInvitationEnded);
    socket.on('conference:invite-result', onInviteResult);
    socket.on('connect', onReconnect);
    return () => {
      socket.off('conference:update', onUpdate);
      socket.off('conference:ended', onEnded);
      socket.off('conference:invitation', onInvitation);
      socket.off('conference:invitation-ended', onInvitationEnded);
      socket.off('conference:invite-result', onInviteResult);
      socket.off('connect', onReconnect);
    };
  }, [socket, showNotice, endedByServer]);

  // Logging out (or switching account) leaves the call and stops any ringing screen
  useEffect(() => {
    if (!socket) {
      if (statusRef.current !== 'idle') {
        teardown();
      }
      clearInvitation();
    }
  }, [socket, teardown, clearInvitation]);

  // The call you were on became a conference (someone was added): join it
  useEffect(() => {
    if (pendingConferenceId && statusRef.current === 'idle') {
      const id = pendingConferenceId;
      clearPendingConferenceId();
      joinConference(id);
    }
  }, [pendingConferenceId, clearPendingConferenceId, joinConference]);

  // The people in the call, with what Agora says about each (video on, muted, talking)
  const people = useMemo(
    () =>
      (conference?.participants || []).map(p => {
        const isMe = p.id === myId;
        const uid = isMe ? 0 : uidByAccount[p.id];
        return {
          ...p,
          isMe,
          uid,
          videoOn: isMe ? cameraOn : !!videoUids[uid],
          muted: isMe ? muted : p.muted || !!mutedUids[uid],
          speaking: isMe
            ? speakingUid === 0
            : uid !== undefined && uid === speakingUid,
        };
      }),
    [
      conference,
      myId,
      uidByAccount,
      videoUids,
      mutedUids,
      speakingUid,
      cameraOn,
      muted,
    ],
  );
  const invited = conference?.invited || NOBODY;

  const value = useMemo(
    () => ({
      status,
      conference,
      people,
      invited,
      muted,
      cameraOn,
      speakerOn,
      frontCamera,
      connection,
      notice,
      speakingUid,
      invitation,
      joinConference,
      leaveConference,
      toggleMute,
      toggleCamera,
      flipCamera,
      toggleSpeaker,
      inviteByNumber,
      cancelInvite,
      acceptInvitation,
      declineInvitation,
      setVisibleAccounts,
    }),
    [
      status,
      conference,
      people,
      invited,
      muted,
      cameraOn,
      speakerOn,
      frontCamera,
      connection,
      notice,
      speakingUid,
      invitation,
      joinConference,
      leaveConference,
      toggleMute,
      toggleCamera,
      flipCamera,
      toggleSpeaker,
      inviteByNumber,
      cancelInvite,
      acceptInvitation,
      declineInvitation,
      setVisibleAccounts,
    ],
  );

  return (
    <ConferenceContext.Provider value={value}>
      {children}
    </ConferenceContext.Provider>
  );
}

export function useConference() {
  const ctx = useContext(ConferenceContext);
  if (!ctx) {
    throw new Error('useConference must be used inside ConferenceProvider');
  }
  return ctx;
}
