import {
  ChannelProfileType,
  ClientRoleType,
  ConnectionStateType,
  RemoteAudioState,
  RemoteVideoState,
  createAgoraRtcEngine,
} from 'react-native-agora';

// One group meeting on Agora: many people in ONE channel. This only talks to Agora and reports what happened through
// `handlers`; MeetingContext decides what to show. (The one-to-one calls in src/calling/agoraCall.js are separate.)
//
// The server makes the token for a user account (the person's own id), so the join uses joinChannelWithUserAccount.
// Agora gives each remote person a numeric uid; `accountOf(uid)` says which person that is (the id the server knows).

// Video is sent small in a group (a phone downloads every other person's video, so a big picture from each
// would be too much); the screen share is sent bigger because text has to stay readable.
const CAMERA = {
  dimensions: { width: 640, height: 360 },
  frameRate: 15,
  bitrate: 0,
};
const SCREEN = {
  dimensions: { width: 1280, height: 720 },
  frameRate: 10,
  bitrate: 0,
};

export async function joinMeetingChannel({
  appId,
  channel,
  account,
  token,
  handlers,
}) {
  const engine = createAgoraRtcEngine();
  let released = false;
  let cameraOn = false;
  let sharing = false;

  const accountOf = uid => {
    try {
      return engine.getUserInfoByUid(uid)?.userAccount || null;
    } catch (e) {
      return null;
    }
  };

  const eventHandler = {
    onJoinChannelSuccess: connection =>
      handlers.onJoined?.(connection?.localUid),
    onUserJoined: (_conn, uid) => handlers.onUserJoined(uid, accountOf(uid)),
    // the account of someone who joined is sometimes known a moment later
    onUserInfoUpdated: (uid, info) =>
      handlers.onUserJoined(uid, info?.userAccount || accountOf(uid)),
    onUserOffline: (_conn, uid) => handlers.onUserOffline(uid),
    onRemoteVideoStateChanged: (_conn, uid, state) =>
      handlers.onRemoteVideo(
        uid,
        state === RemoteVideoState.RemoteVideoStateDecoding,
      ),
    onRemoteAudioStateChanged: (_conn, uid, state) =>
      handlers.onRemoteMuted(
        uid,
        state === RemoteAudioState.RemoteAudioStateStopped,
      ),
    // who is talking: uid 0 is this phone
    onAudioVolumeIndication: (_conn, speakers) =>
      handlers.onSpeakers?.(
        (speakers || []).map(s => ({ uid: s.uid || 0, volume: s.volume || 0 })),
      ),
    onTokenPrivilegeWillExpire: () => handlers.onTokenWillExpire?.(),
    onConnectionStateChanged: (_conn, state) => {
      if (state === ConnectionStateType.ConnectionStateReconnecting) {
        handlers.onReconnecting?.();
      } else if (state === ConnectionStateType.ConnectionStateConnected) {
        handlers.onReconnected?.();
      } else if (state === ConnectionStateType.ConnectionStateFailed) {
        handlers.onFailed?.();
      }
    },
    // sharing stopped from outside the app (the phone's own "stop sharing" button)
    onLocalVideoStateChanged: (source, state) => {
      const stopped = state === 0 || state === 3; // stopped / failed
      const isScreen = source === 2 || source === 3; // the screen, not a camera
      if (sharing && stopped && isScreen) {
        handlers.onShareStopped?.();
      }
    },
  };

  const release = () => {
    if (released) {
      return;
    }
    released = true;
    try {
      if (sharing) {
        engine.stopScreenCapture();
      }
      engine.unregisterEventHandler(eventHandler);
      engine.leaveChannel();
      engine.release();
    } catch (e) {
      console.warn('Could not close the Agora meeting cleanly', e);
    }
  };

  try {
    const started = engine.initialize({
      appId,
      channelProfile: ChannelProfileType.ChannelProfileCommunication,
    });
    if (started < 0) {
      throw new Error(`Agora could not start (${started})`);
    }
    engine.registerEventHandler(eventHandler);
    engine.enableAudio();
    engine.enableVideo();
    engine.setVideoEncoderConfiguration(CAMERA);
    engine.enableAudioVolumeIndication(500, 3, true);
    const joined = engine.joinChannelWithUserAccount(token, channel, account, {
      clientRoleType: ClientRoleType.ClientRoleBroadcaster,
      channelProfile: ChannelProfileType.ChannelProfileCommunication,
      publishMicrophoneTrack: true,
      publishCameraTrack: false, // a meeting starts with the camera off
      autoSubscribeAudio: true,
      autoSubscribeVideo: true,
    });
    if (joined < 0) {
      throw new Error(`Agora could not join the meeting (${joined})`);
    }
  } catch (e) {
    release();
    throw e;
  }

  return {
    get cameraOn() {
      return cameraOn;
    },
    get sharing() {
      return sharing;
    },
    accountOf,
    setMuted: muted => engine.muteLocalAudioStream(muted),
    setSpeaker: on => engine.setEnableSpeakerphone(on),
    switchCamera: () => engine.switchCamera(),
    setCamera: on => {
      cameraOn = on;
      if (on) {
        engine.enableLocalVideo(true);
        engine.startPreview();
      } else {
        engine.stopPreview();
        engine.enableLocalVideo(false);
      }
      engine.updateChannelMediaOptions({ publishCameraTrack: on });
    },
    // Android: the screen goes out instead of the camera while sharing, and the camera comes back afterwards
    startScreenShare: () => {
      const result = engine.startScreenCapture({
        captureVideo: true,
        captureAudio: false,
        videoParams: SCREEN,
      });
      if (result < 0) {
        throw new Error(`Agora could not start screen sharing (${result})`);
      }
      sharing = true;
      engine.updateChannelMediaOptions({
        publishScreenCaptureVideo: true,
        publishCameraTrack: false,
      });
    },
    stopScreenShare: () => {
      if (!sharing) {
        return;
      }
      sharing = false;
      engine.updateChannelMediaOptions({
        publishScreenCaptureVideo: false,
        publishCameraTrack: cameraOn,
      });
      engine.stopScreenCapture();
    },
    renewToken: newToken => engine.renewToken(newToken),
    // Only the people on screen need their video; the rest are heard but not downloaded
    setRemoteVideoShown: (uid, shown) =>
      engine.muteRemoteVideoStream(uid, !shown),
    leave: release,
  };
}
