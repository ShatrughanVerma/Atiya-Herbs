import React from 'react';
import { VideoTrack } from '@livekit/react-native';
import { RenderModeType, RtcSurfaceView, VideoMirrorModeType } from 'react-native-agora';

// Shows one person's video, whichever calling provider the call runs on.
// `trackRef` is what CallContext keeps: a LiveKit track reference, or {agora: true, uid} for an Agora call
// (uid 0 is this phone's own camera).
export default function CallVideo({ trackRef, style, mirror = false, zOrder = 0 }) {
  if (trackRef?.agora) {
    return (
      <RtcSurfaceView
        style={style}
        zOrderMediaOverlay={zOrder > 0}
        canvas={{
          uid: trackRef.uid,
          renderMode: RenderModeType.RenderModeHidden,
          mirrorMode: mirror ? VideoMirrorModeType.VideoMirrorModeEnabled : VideoMirrorModeType.VideoMirrorModeDisabled,
        }}
      />
    );
  }
  return <VideoTrack trackRef={trackRef} style={style} objectFit="cover" mirror={mirror} zOrder={zOrder} />;
}
