import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Alert, Platform, Vibration } from 'react-native';
import { io } from 'socket.io-client';
import { AudioSession } from '@livekit/react-native';
import { Room, RoomEvent, Track } from 'livekit-client';
import { CALL_BACKEND_URL } from '../config/calls';
import { ensureCallPermissions } from '../utils/callPermissions';
import { normalizeMobile } from '../utils/phone';
import { useAuth } from './AuthContext';

// One-to-one voice and video calls.
//  - Ringing: the Socket.IO connection to call-backend/ (call:start / incoming / accept / reject / end).
//  - Audio and video: LiveKit. When the callee accepts, the backend gives both people a token for
//    that call's own room, and each phone joins it with livekit-client.
//
// call.status: calling → ringing → connecting → connected (↔ reconnecting) → ended
// An incoming call starts at ringing. "ended" shows the reason for a moment, then the call closes.
// call.video turns true when either side switches on their camera in a voice call.

const CallContext = createContext(null);

// People call each other by mobile number: the 10-digit number is the call id.
export const callUserId = user => normalizeMobile(user?.mobile);

const START_ERRORS = {
  offline: name =>
    `${name} is not using Atiya Herbs right now. Calls work when the app is open on their phone.`,
  busy: name => `${name} is on another call.`,
  'in-call': () => 'You are already on a call.',
  self: () => 'You can’t call yourself.',
  'not-configured': () =>
    'Calling is not set up on the server yet (LiveKit keys are missing).',
};

const endMessage = (reason, direction) => {
  if (reason === 'rejected') {
    return 'Call declined';
  }
  if (reason === 'no-answer') {
    return direction === 'outgoing' ? 'No answer' : 'Missed call';
  }
  if (reason === 'cancelled') {
    return 'Missed call';
  }
  if (reason === 'disconnected') {
    return 'Call disconnected';
  }
  return 'Call ended';
};

const ENDED_SCREEN_MS = 1500;
const RING_VIBRATION = [0, 800, 1200];
const MAX_HISTORY = 100;
const NO_PEER_MEDIA = { muted: false, videoOff: false };

const cameraRef = (participant, publication) => ({
  participant,
  publication,
  source: Track.Source.Camera,
});

export function CallProvider({ children }) {
  const { user } = useAuth();
  const myId = callUserId(user);
  const myName = user?.name || myId;

  const [serverConnected, setServerConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [call, setCall] = useState(null); // {id, peer: {id, name}, video, direction, status, connectedAt, endText}
  const [history, setHistory] = useState([]); // newest first: {id, peer, video, direction, outcome, at, duration}
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [frontCamera, setFrontCamera] = useState(true);
  const [localVideo, setLocalVideo] = useState(null); // track references for <VideoTrack>
  const [remoteVideo, setRemoteVideo] = useState(null);
  const [peerMedia, setPeerMedia] = useState(NO_PEER_MEDIA); // the other person's mic / camera state

  // Socket and LiveKit callbacks read these refs, so they always see the latest values
  const socketRef = useRef(null);
  const callRef = useRef(null);
  const roomRef = useRef(null);
  const closeTimerRef = useRef(null);
  const audioStartedRef = useRef(false);
  const speakerRef = useRef(false);
  const mutedRef = useRef(false);
  const frontRef = useRef(true);
  const nextHistoryId = useRef(1);

  const setCurrent = useCallback(next => {
    clearTimeout(closeTimerRef.current);
    callRef.current = next;
    setCall(next);
  }, []);

  const patch = useCallback(fields => {
    if (callRef.current) {
      callRef.current = { ...callRef.current, ...fields };
      setCall(callRef.current);
    }
  }, []);

  const emit = useCallback(
    (event, payload, ack) => socketRef.current?.emit(event, payload, ack),
    [],
  );

  // Earpiece for voice calls, loudspeaker for video calls (and the speaker button)
  const setSpeaker = useCallback(async on => {
    speakerRef.current = on;
    setSpeakerOn(on);
    if (!audioStartedRef.current) {
      return;
    }
    try {
      const output =
        Platform.OS === 'ios'
          ? on
            ? 'force_speaker'
            : 'default'
          : on
          ? 'speaker'
          : 'earpiece';
      await AudioSession.selectAudioOutput(output);
    } catch (e) {
      console.warn('Could not change the audio output', e);
    }
  }, []);

  // Works out what to show from the LiveKit room: both videos and the other person's mic / camera
  const refreshMedia = useCallback(() => {
    const room = roomRef.current;
    if (!room) {
      return;
    }
    const local = room.localParticipant;
    const remote = [...room.remoteParticipants.values()][0];
    const localPub = local.getTrackPublication(Track.Source.Camera);
    const remotePub = remote?.getTrackPublication(Track.Source.Camera);
    const localLive = !!localPub?.track && !localPub.isMuted;
    const remoteLive = !!remotePub?.track && !remotePub.isMuted;

    setLocalVideo(localLive ? cameraRef(local, localPub) : null);
    setRemoteVideo(remoteLive ? cameraRef(remote, remotePub) : null);
    setCameraOn(localLive);
    setPeerMedia(
      remote
        ? {
            muted: !remote.isMicrophoneEnabled,
            videoOff: !remote.isCameraEnabled,
          }
        : NO_PEER_MEDIA,
    );
    if (remote && callRef.current && callRef.current.status === 'connecting') {
      patch({ status: 'connected', connectedAt: Date.now() });
    }
    // Either side switching on a camera turns a voice call into a video call
    if (
      (remoteLive || localLive) &&
      callRef.current &&
      !callRef.current.video
    ) {
      patch({ video: true });
      setSpeaker(true);
    }
  }, [patch, setSpeaker]);

  // Leaves LiveKit and releases the mic, camera and phone audio
  const leaveRoom = useCallback(() => {
    const room = roomRef.current;
    roomRef.current = null;
    room?.removeAllListeners();
    room?.disconnect().catch(() => {});
    if (audioStartedRef.current) {
      audioStartedRef.current = false;
      AudioSession.stopAudioSession().catch(() => {});
    }
    setLocalVideo(null);
    setRemoteVideo(null);
    setPeerMedia(NO_PEER_MEDIA);
    setCameraOn(false);
    setMuted(false);
    mutedRef.current = false;
    setSpeakerOn(false);
    speakerRef.current = false;
    setFrontCamera(true);
    frontRef.current = true;
  }, []);

  // Closes the call: logs it in the Calls list, shows why it ended for a moment, then closes the screen
  const finish = useCallback(
    (outcome, endText) => {
      const current = callRef.current;
      if (!current || current.status === 'ended') {
        return;
      }
      Vibration.cancel();
      leaveRoom();
      const duration = current.connectedAt
        ? Math.round((Date.now() - current.connectedAt) / 1000)
        : 0;
      setHistory(list =>
        [
          {
            id: String(nextHistoryId.current++),
            peer: current.peer,
            video: current.video,
            direction: current.direction,
            outcome,
            at: Date.now(),
            duration,
          },
          ...list,
        ].slice(0, MAX_HISTORY),
      );
      patch({ status: 'ended', endText });
      closeTimerRef.current = setTimeout(
        () => setCurrent(null),
        ENDED_SCREEN_MS,
      );
    },
    [leaveRoom, patch, setCurrent],
  );

  // Silent close (no entry in the log): the call never really started
  const abandon = useCallback(() => {
    Vibration.cancel();
    leaveRoom();
    setCurrent(null);
  }, [leaveRoom, setCurrent]);

  const joinRoom = useCallback(
    async ({ serverUrl, token }) => {
      const current = callRef.current;
      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      room
        .on(RoomEvent.ParticipantConnected, refreshMedia)
        .on(RoomEvent.ParticipantDisconnected, () => {
          // The other person left the room; the server's call:ended normally arrives first
          const c = callRef.current;
          if (c && c.status === 'connected') {
            emit('call:end', { callId: c.id });
            finish('answered', 'Call ended');
          }
        })
        .on(RoomEvent.TrackSubscribed, refreshMedia)
        .on(RoomEvent.TrackUnsubscribed, refreshMedia)
        .on(RoomEvent.TrackMuted, refreshMedia)
        .on(RoomEvent.TrackUnmuted, refreshMedia)
        .on(RoomEvent.LocalTrackPublished, refreshMedia)
        .on(RoomEvent.LocalTrackUnpublished, refreshMedia)
        .on(
          RoomEvent.Reconnecting,
          () =>
            callRef.current?.status === 'connected' &&
            patch({ status: 'reconnecting' }),
        )
        .on(
          RoomEvent.Reconnected,
          () =>
            callRef.current?.status === 'reconnecting' &&
            patch({ status: 'connected' }),
        )
        .on(RoomEvent.Disconnected, () => {
          const c = callRef.current;
          if (c && roomRef.current === room && c.status !== 'ended') {
            emit('call:end', { callId: c.id });
            finish(
              c.connectedAt ? 'answered' : 'missed',
              c.connectedAt ? 'Connection lost' : 'Could not connect',
            );
          }
        });

      await AudioSession.startAudioSession();
      audioStartedRef.current = true;
      await setSpeaker(current.video);
      await room.connect(serverUrl, token);
      if (roomRef.current !== room) {
        return; // the call ended while connecting
      }
      await room.localParticipant.setMicrophoneEnabled(true);
      if (current.video) {
        await room.localParticipant.setCameraEnabled(true, {
          facingMode: 'user',
        });
      }
      refreshMedia();
    },
    [emit, finish, patch, refreshMedia, setSpeaker],
  );

  const startCall = useCallback(
    async (peer, video) => {
      if (callRef.current && callRef.current.status !== 'ended') {
        return;
      }
      if (!socketRef.current?.connected) {
        Alert.alert(
          'Calls',
          'Not connected to the call server. Check your internet and try again.',
        );
        return;
      }
      if (!(await ensureCallPermissions(video))) {
        Alert.alert(
          'Permission needed',
          `Allow microphone${
            video ? ' and camera' : ''
          } access to make the call.`,
        );
        return;
      }
      const attempt = {}; // tells this attempt apart if the user hangs up and calls again quickly
      setCurrent({
        id: null,
        attempt,
        peer,
        video: !!video,
        direction: 'outgoing',
        status: 'calling',
      });

      emit('call:start', { to: peer.id, video: !!video }, res => {
        if (callRef.current?.attempt !== attempt) {
          if (res?.ok) {
            emit('call:end', { callId: res.callId }); // hung up before the server answered
          }
          return;
        }
        if (!res?.ok) {
          abandon();
          const message = START_ERRORS[res?.error];
          Alert.alert(
            'Calls',
            message ? message(peer.name) : 'Could not start the call.',
          );
          return;
        }
        patch({ id: res.callId, status: 'ringing' });
      });
    },
    [abandon, emit, patch, setCurrent],
  );

  const acceptCall = useCallback(async () => {
    const current = callRef.current;
    if (current?.direction !== 'incoming' || current.status !== 'ringing') {
      return;
    }
    Vibration.cancel();
    if (!(await ensureCallPermissions(current.video))) {
      emit('call:reject', { callId: current.id });
      abandon();
      Alert.alert(
        'Permission needed',
        `Allow microphone${
          current.video ? ' and camera' : ''
        } access to answer calls.`,
      );
      return;
    }
    if (callRef.current?.id !== current.id) {
      return; // the caller hung up while the permission dialog was open
    }
    patch({ status: 'connecting' });
    emit('call:accept', { callId: current.id });
  }, [abandon, emit, patch]);

  const rejectCall = useCallback(() => {
    const current = callRef.current;
    if (current?.direction === 'incoming' && current.status === 'ringing') {
      emit('call:reject', { callId: current.id });
      Vibration.cancel();
      finish('declined', 'Call declined');
    }
  }, [emit, finish]);

  const endCall = useCallback(() => {
    const current = callRef.current;
    if (!current || current.status === 'ended') {
      return;
    }
    if (current.id) {
      emit('call:end', { callId: current.id });
    }
    if (current.connectedAt) {
      finish('answered', 'Call ended');
    } else {
      finish(
        current.direction === 'outgoing' ? 'cancelled' : 'missed',
        'Call ended',
      );
    }
  }, [emit, finish]);

  const toggleMute = useCallback(async () => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    await roomRef.current?.localParticipant
      .setMicrophoneEnabled(!next)
      .catch(() => {});
  }, []);

  const toggleSpeaker = useCallback(
    () => setSpeaker(!speakerRef.current),
    [setSpeaker],
  );

  // Camera on/off. In a voice call this switches to video, like the video button in WhatsApp.
  const toggleCamera = useCallback(async () => {
    const room = roomRef.current;
    const current = callRef.current;
    if (!room || !current || current.status === 'ended') {
      return;
    }
    const turnOn = !room.localParticipant.isCameraEnabled;
    if (turnOn && !(await ensureCallPermissions(true))) {
      Alert.alert(
        'Permission needed',
        'Allow camera access to turn on your video.',
      );
      return;
    }
    try {
      await room.localParticipant.setCameraEnabled(
        turnOn,
        turnOn
          ? { facingMode: frontRef.current ? 'user' : 'environment' }
          : undefined,
      );
    } catch (e) {
      Alert.alert('Calls', 'Could not open the camera.');
    }
    refreshMedia();
  }, [refreshMedia]);

  const flipCamera = useCallback(async () => {
    const publication = roomRef.current?.localParticipant.getTrackPublication(
      Track.Source.Camera,
    );
    if (!publication?.track) {
      return;
    }
    const front = !frontRef.current;
    try {
      await publication.track.restartTrack({
        facingMode: front ? 'user' : 'environment',
      });
      frontRef.current = front;
      setFrontCamera(front);
    } catch (e) {
      Alert.alert('Calls', 'Could not switch the camera.');
    }
  }, []);

  const clearHistory = useCallback(() => setHistory([]), []);

  // Connect to the call backend while someone with a mobile number is logged in
  useEffect(() => {
    if (!myId) {
      return;
    }
    const socket = io(CALL_BACKEND_URL, {
      transports: ['websocket'],
      auth: { userId: myId, name: myName },
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;

    socket.on('connect', () => setServerConnected(true));
    socket.on('disconnect', () => setServerConnected(false));
    socket.on('connect_error', () => setServerConnected(false));

    socket.on('session', ({ activeCallId }) => {
      // The server still thinks we're in a call this phone no longer has (e.g. after an app restart)
      if (activeCallId && activeCallId !== callRef.current?.id) {
        socket.emit('call:end', { callId: activeCallId });
      }
    });

    socket.on('users', list => setOnlineUsers(list.filter(u => u.id !== myId)));

    socket.on('call:incoming', ({ callId, from, video }) => {
      if (callRef.current && callRef.current.status !== 'ended') {
        socket.emit('call:reject', { callId });
        return;
      }
      setCurrent({
        id: callId,
        peer: from,
        video,
        direction: 'incoming',
        status: 'ringing',
      });
      setSpeakerOn(false);
      Vibration.vibrate(RING_VIBRATION, true);
    });

    // Both people get this once the callee has accepted: join the call's LiveKit room
    socket.on('call:ready', async payload => {
      const current = callRef.current;
      if (
        !current ||
        payload.callId !== current.id ||
        current.status === 'ended'
      ) {
        return;
      }
      patch({ status: 'connecting' });
      try {
        await joinRoom(payload);
      } catch (e) {
        console.warn('Could not join the call', e);
        if (callRef.current?.id === payload.callId) {
          socket.emit('call:end', { callId: payload.callId });
          finish('missed', 'Could not connect');
        }
      }
    });

    socket.on('call:ended', ({ callId, reason }) => {
      const current = callRef.current;
      if (current && callId === current.id) {
        const answered = !!current.connectedAt;
        const outcome = answered
          ? 'answered'
          : reason === 'rejected'
          ? 'declined'
          : current.direction === 'outgoing'
          ? 'no-answer'
          : 'missed';
        finish(outcome, endMessage(reason, current.direction));
      }
    });

    return () => {
      // Logging out (or switching account) hangs up and goes offline
      const current = callRef.current;
      if (current?.id && current.status !== 'ended') {
        socket.emit('call:end', { callId: current.id });
      }
      Vibration.cancel();
      leaveRoom();
      setCurrent(null);
      socket.disconnect();
      socketRef.current = null;
      setServerConnected(false);
      setOnlineUsers([]);
    };
  }, [myId, myName, finish, joinRoom, leaveRoom, patch, setCurrent]);

  const value = useMemo(
    () => ({
      myId,
      serverConnected,
      onlineUsers,
      call,
      history,
      muted,
      speakerOn,
      cameraOn,
      frontCamera,
      localVideo,
      remoteVideo,
      peerMedia,
      startCall,
      acceptCall,
      rejectCall,
      endCall,
      toggleMute,
      toggleSpeaker,
      toggleCamera,
      flipCamera,
      clearHistory,
    }),
    [
      myId,
      serverConnected,
      onlineUsers,
      call,
      history,
      muted,
      speakerOn,
      cameraOn,
      frontCamera,
      localVideo,
      remoteVideo,
      peerMedia,
      startCall,
      acceptCall,
      rejectCall,
      endCall,
      toggleMute,
      toggleSpeaker,
      toggleCamera,
      flipCamera,
      clearHistory,
    ],
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) {
    throw new Error('useCall must be used inside CallProvider');
  }
  return ctx;
}
