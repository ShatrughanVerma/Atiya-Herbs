import {
  ChannelProfileType,
  ClientRoleType,
  ConnectionStateType,
  RemoteAudioState,
  RemoteVideoState,
  createAgoraRtcEngine,
} from 'react-native-agora';

// One Agora call: the same job livekit-client does for a LiveKit call. CallContext decides which one to use from the
// `provider` the server sends in call:ready. This file only talks to Agora and reports what happened through
// `handlers`, so the rest of the call code does not need to know Agora's API.
//
// The server makes the token for a user account (not a number), so the join uses joinChannelWithUserAccount.
// Agora gives the other person a numeric uid when they join; that uid is what the video views need.

export async function joinAgoraCall({
  appId,
  channel,
  account,
  token,
  video,
  handlers,
}) {
  const engine = createAgoraRtcEngine();
  let released = false;
  let cameraOn = !!video;

  const eventHandler = {
    onUserJoined: (_conn, uid) => handlers.onRemoteJoined(uid),
    onUserOffline: (_conn, uid) => handlers.onRemoteLeft(uid),
    onRemoteVideoStateChanged: (_conn, uid, state) =>
      handlers.onRemoteVideo(uid, state === RemoteVideoState.RemoteVideoStateDecoding),
    onRemoteAudioStateChanged: (_conn, uid, state) =>
      handlers.onRemoteMuted(uid, state === RemoteAudioState.RemoteAudioStateStopped),
    onConnectionStateChanged: (_conn, state) => {
      if (state === ConnectionStateType.ConnectionStateReconnecting) {
        handlers.onReconnecting();
      } else if (state === ConnectionStateType.ConnectionStateConnected) {
        handlers.onReconnected();
      } else if (state === ConnectionStateType.ConnectionStateFailed) {
        handlers.onFailed();
      }
    },
  };

  const release = () => {
    if (released) {
      return;
    }
    released = true;
    try {
      engine.unregisterEventHandler(eventHandler);
      engine.leaveChannel();
      engine.release();
    } catch (e) {
      console.warn('Could not close the Agora call cleanly', e);
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
    if (video) {
      engine.enableVideo();
      engine.startPreview();
    }
    const joined = engine.joinChannelWithUserAccount(token, channel, account, {
      clientRoleType: ClientRoleType.ClientRoleBroadcaster,
      channelProfile: ChannelProfileType.ChannelProfileCommunication,
      publishMicrophoneTrack: true,
      publishCameraTrack: !!video,
      autoSubscribeAudio: true,
      autoSubscribeVideo: true,
    });
    if (joined < 0) {
      throw new Error(`Agora could not join the call (${joined})`);
    }
  } catch (e) {
    release();
    throw e;
  }

  return {
    get cameraOn() {
      return cameraOn;
    },
    setMuted: muted => engine.muteLocalAudioStream(muted),
    setSpeaker: on => engine.setEnableSpeakerphone(on),
    switchCamera: () => engine.switchCamera(),
    // Turning the camera on during a voice call starts the video, like the video button in WhatsApp
    setCamera: on => {
      cameraOn = on;
      if (on) {
        engine.enableVideo();
        engine.enableLocalVideo(true);
        engine.startPreview();
      } else {
        engine.stopPreview();
        engine.enableLocalVideo(false);
      }
      engine.updateChannelMediaOptions({publishCameraTrack: on});
    },
    leave: release,
  };
}
